"""Read-only Codex rollout adapter. No model calls and no history modifications."""
from __future__ import annotations

import collections
import contextlib
import datetime as dt
import io
import json
import pathlib
import re
from swimlane.activity import derive_activity

ENCRYPTED = re.compile(r"gAAAAA[A-Za-z0-9_=\-]{40,}")
SECRET = re.compile(r"\b(?:sk-[A-Za-z0-9_-]{20,}|Bearer\s+[A-Za-z0-9._-]{20,})")
PREVIEW_LIMIT = 18000


def clean(value):
    text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
    return SECRET.sub("[credential redacted]", ENCRYPTED.sub("[encrypted content unavailable]", text))


def content_text(value):
    if isinstance(value, str):
        return clean(value)
    if isinstance(value, list):
        return "\n".join(content_text(v) for v in value)
    if isinstance(value, dict):
        if value.get("type") == "encrypted_content":
            return "[encrypted content unavailable]"
        if "text" in value:
            return clean(value["text"])
        if value.get("type") in ("image", "input_image", "image_url", "audio"):
            return "[non-text content]"
    return clean(value) if value is not None else ""


def millis(timestamp):
    if not timestamp:
        return 0
    return int(dt.datetime.fromisoformat(timestamp.replace("Z", "+00:00")).timestamp() * 1000)


def read_events(path):
    """Stream JSONL or Zstandard JSONL; preserve physical line provenance."""
    with contextlib.ExitStack() as stack:
        raw = stack.enter_context(path.open("rb"))
        if path.suffix == ".zst":
            try:
                import zstandard
            except ImportError as exc:
                raise RuntimeError("Install requirements.txt to read .jsonl.zst history") from exc
            raw = stack.enter_context(zstandard.ZstdDecompressor().stream_reader(raw))
        stream = stack.enter_context(io.TextIOWrapper(raw, encoding="utf-8"))
        for line_number, line in enumerate(stream, 1):
            if not line.strip():
                continue
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                yield {"type": "parse_error", "line": line_number}
                continue
            event["line"] = line_number
            yield event


def spawn_info(meta):
    source = meta.get("source")
    if not isinstance(source, dict):
        return {}
    sub = source.get("subagent", {})
    return sub.get("thread_spawn", {}) if isinstance(sub, dict) else {}


def prompt_title(text):
    text = text.split("## My request:", 1)[-1].strip()
    # Attachment wrappers and standalone links are context, not useful titles.
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    while len(lines) > 1 and (lines[0].startswith(("https://", "http://", "[https://", "[http://"))):
        lines.pop(0)
    title = " ".join(lines)
    return title[:177]+"…" if len(title) > 180 else title


def summarize(path):
    meta, title = {}, ""
    calls = usage = spawns = errors = 0
    turns = set()
    for event in read_events(path):
        typ, p = event.get("type"), event.get("payload") or {}
        if typ == "session_meta":
            meta = p
        elif typ == "parse_error":
            errors += 1
        elif typ == "event_msg" and p.get("type") == "task_started":
            turns.add(p.get("turn_id") or event["line"])
        elif typ == "token_usage_record":
            usage += 1
        elif typ == "response_item":
            if p.get("type") in ("function_call", "custom_tool_call"):
                calls += 1
                spawns += p.get("name", "").split(".")[-1] == "spawn_agent"
            if p.get("role") == "user" and not title:
                kinds = p.get("internal_chat_message_metadata_passthrough", {}).get("content_item_kinds", [])
                text = content_text(p.get("content", []))
                if "user.text" in kinds or (not kinds and not text.startswith(("<", "# AGENTS"))):
                    title = prompt_title(text)
    parent = spawn_info(meta)
    return {"id": meta.get("id", path.stem), "title": title or pathlib.PureWindowsPath(meta.get("cwd", "Untitled session")).name,
            "path": str(path), "started": meta.get("timestamp"), "calls": calls, "usage_records": usage,
            "turns": len(turns), "spawn_calls": spawns, "parent_id": parent.get("parent_thread_id"),
            "agent_path": parent.get("agent_path"), "source": meta.get("source"), "cwd": meta.get("cwd"),
            "parse_errors": errors, "cli_version": meta.get("cli_version")}


def normalize(path):
    raw = list(read_events(path))
    meta = next((e["payload"] for e in raw if e["type"] == "session_meta"), {})
    sid = meta.get("id", path.stem)
    ancestry = spawn_info(meta)
    agent_path = ancestry.get("agent_path", "/root")
    spans, rounds, messages, turns, content = [], [], [], [], collections.Counter()
    current_turn, current_model = None, None
    calls, completed, usage_ids, count_signatures = {}, set(), set(), set()
    turn_map = {}
    has_direct_usage = any(e["type"] == "token_usage_record" for e in raw)
    notices = []

    def base(e, kind, label, text="", **extra):
        text = clean(text)
        return {"id": f"{sid}:{e['line']}:{kind}", "agent_id": sid, "kind": kind, "label": label,
                "time": millis(e.get("timestamp")), "turn_id": current_turn, "model": current_model,
                "text": text[:PREVIEW_LIMIT], "text_length": len(text), "truncated": len(text) > PREVIEW_LIMIT,
                "source": {"file": str(path), "line": e["line"], "ordinal": e.get("ordinal"), "type": e["type"]},
                "confidence": "reported", **extra}

    for e in raw:
        typ, p = e.get("type"), e.get("payload") or {}
        kind = p.get("type")
        time = millis(e.get("timestamp"))
        if typ == "parse_error":
            notices.append(f"Skipped malformed JSON at line {e['line']} (possibly an unfinished live write).")
            continue
        if typ == "turn_context":
            current_turn = p.get("turn_id", current_turn)
            current_model = p.get("model", current_model)
        if typ == "event_msg" and kind == "task_started":
            current_turn = p.get("turn_id") or f"turn-{e['line']}"
            turn = {"id": current_turn, "start": time, "end": None, "title": "Agent turn", "agent_id": sid}
            turn_map[current_turn] = turn
            turns.append(turn)
        if typ == "event_msg" and kind in ("task_complete", "task_aborted", "turn_aborted"):
            turn = turn_map.get(p.get("turn_id", current_turn))
            if turn:
                turn["end"] = time
        if typ == "token_usage_record":
            identity = p.get("response_id") or f"line-{e['line']}"
            if identity in usage_ids:
                continue
            usage_ids.add(identity)
            rounds.append(base(e, "round", "Model response", usage=p.get("usage", {}), response_id=p.get("response_id"),
                               turn_id=p.get("turn_id", current_turn), timing="Usage recorded; request start unavailable"))
        elif typ == "event_msg" and kind == "token_count" and not has_direct_usage:
            info = p.get("info") or {}
            usage = info.get("last_token_usage")
            totals = info.get("total_token_usage")
            if usage and totals:
                signature = json.dumps(totals, sort_keys=True)
                if signature not in count_signatures:
                    count_signatures.add(signature)
                    rounds.append(base(e, "round", "Usage update (proxy)", usage=usage, response_id=None,
                                       confidence="inferred", timing="Distinct cumulative usage update; not a confirmed request boundary"))
        if typ == "response_item":
            passthrough = p.get("internal_chat_message_metadata_passthrough", {})
            event_turn = passthrough.get("turn_id", current_turn)
            if kind in ("function_call", "custom_tool_call"):
                name = p.get("name", "tool")
                args = p.get("arguments", p.get("input", ""))
                text = clean(args)
                call = base(e, "tool", name, text, call_id=p.get("call_id"), start=time, end=None,
                            turn_id=event_turn, timing="Call recorded to output recorded", namespace=p.get("namespace"))
                # Retain only routing fields; encrypted prompts stay unavailable.
                try:
                    parsed = json.loads(args) if isinstance(args, str) else args
                    call["routing"] = {k: parsed[k] for k in ("target", "task_name", "agent_id") if k in parsed}
                except (ValueError, TypeError):
                    call["routing"] = {}
                calls[p.get("call_id", call["id"])] = call
                spans.append(call)
                content["Tool call arguments"] += len(ENCRYPTED.sub("", str(args)))
            elif kind in ("function_call_output", "custom_tool_call_output"):
                text = content_text(p.get("output", ""))
                content["Tool returns"] += len(text.replace("[encrypted content unavailable]", ""))
                call = calls.get(p.get("call_id"))
                if call:
                    call.update(end=time, output=text[:PREVIEW_LIMIT], output_length=len(text), output_truncated=len(text)>PREVIEW_LIMIT)
                else:
                    messages.append(base(e, "tool_output", "Unmatched tool output", text, turn_id=event_turn))
            elif kind in ("message", "agent_message"):
                text = content_text(p.get("content", []))
                role = p.get("role", "agent")
                kinds = passthrough.get("content_item_kinds", [])
                origin = ("Agent communication" if kind == "agent_message" else
                          "System / developer" if role in ("system", "developer") else
                          "Human input" if role == "user" and "user.text" in kinds else
                          "User-role context" if role == "user" else "Assistant text")
                content[origin] += len(text.replace("[encrypted content unavailable]", ""))
                label = "Report received" if "Message Type: FINAL_ANSWER" in text else "Message received" if kind == "agent_message" else role.title()
                msg = base(e, "message" if kind == "agent_message" else "text", label, text, role=role, origin=origin,
                           author=p.get("author"), recipient=p.get("recipient"), turn_id=event_turn,
                           encrypted="[encrypted content unavailable]" in text)
                messages.append(msg)
                if origin == "Human input" and event_turn in turn_map:
                    turn_map[event_turn]["title"] = text[:140]
            elif kind == "additional_tools":
                content["Tool definitions"] += len(clean(p.get("tools", [])))
        if typ == "event_msg" and kind == "item_completed":
            item = p.get("item") or {}
            itype = item.get("type", "")
            identity = item.get("id")
            if identity and identity in completed:
                continue
            completed.add(identity)
            if itype in ("Reasoning", "AgentMessage", "UserMessage"):
                continue
            start, end = p.get("started_at_ms"), p.get("completed_at_ms")
            if itype == "SubAgentActivity":
                spans.append(base(e, "lifecycle", item.get("kind", "Agent activity"), clean(item),
                                  target_agent_id=item.get("agent_thread_id"), target_path=item.get("agent_path"), start=start or time, end=end or time))
            elif itype == "ContextCompaction":
                spans.append(base(e, "compaction", "Context compaction", "Context compaction recorded by Codex.", start=start or time, end=end or time))
            else:
                label = item.get("tool") or item.get("kind") or itype
                # Nested execution is separate from model-issued wrapper calls.
                spans.append(base(e, "execution", label, clean(item), start=start or time, end=end or time,
                                  turn_id=p.get("turn_id", current_turn), timing="Recorded item execution timestamps" if start is not None and end is not None else "Only completion timestamp available"))
    for n, r in enumerate(rounds, 1):
        r["number"] = n
        r["label"] = f"Response {n}" if r["response_id"] else f"Usage update {n}"
    times = [millis(e.get("timestamp")) for e in raw if e.get("timestamp")]
    return {"id": sid, "harness": "codex", "path": agent_path, "nickname": ancestry.get("agent_nickname"),
            "parent_id": ancestry.get("parent_thread_id"), "start": min(times, default=0), "end": max(times, default=0),
            "cli_version": meta.get("cli_version"), "turns": turns, "rounds": rounds, "spans": spans,
            "messages": messages, "content_chars": dict(content), "notices": notices}


def build_case(root, members):
    agents = [normalize(pathlib.Path(m["path"])) for m in members]
    from swimlane.cases import assemble_case
    return assemble_case(root, members, agents)
