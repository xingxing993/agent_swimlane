"""Derive workflow activity, not hardware utilization, from normalized evidence."""


WAIT_TOOLS = {"wait", "wait_agent", "sleep", "request_user_input", "request_user_input_async"}


def derive_activity(agent):
    """Partition each observed turn; never stretch intervals over between-turn gaps.

    Precedence: explicit waits/compaction > tool envelopes > response-window
    inference > unknown. Across agents, all intervals remain independent.
    """
    result = []
    spans = agent["spans"]
    for turn in agent["turns"]:
        start = turn["start"]
        # An unfinished turn stops at its last evidence, not at wall-clock now.
        evidence = [e for e in agent["rounds"]+spans+agent["messages"] if e.get("turn_id") == turn["id"]]
        end = turn["end"] if turn["end"] is not None else max((e.get("end") or e["time"] for e in evidence), default=start)
        if end <= start:
            continue
        candidates = []

        def add(lo, hi, resource, phase, priority, refs, confidence, explanation):
            lo, hi = max(start, lo), min(end, hi)
            if hi > lo:
                candidates.append(dict(start=lo, end=hi, resource=resource, phase=phase,
                                       priority=priority, refs=refs, confidence=confidence, explanation=explanation))

        for e in spans:
            if e["kind"] not in ("tool", "execution", "compaction"):
                continue
            lo, hi = e.get("start"), e.get("end")
            if lo is None or lo >= end or (hi is not None and hi <= start):
                continue
            if hi is None:
                if e.get("turn_id") == turn["id"]:
                    add(lo, end, "other", "unknown", 5, [e], "inferred", "Tool end is missing. This interval cannot be assigned to model inference or measured tool execution.")
                continue
            name = e["label"].split(".")[-1]
            if e["kind"] == "compaction":
                add(lo, hi, "other", "compaction", 4, [e], "reported", "Recorded compaction envelope. Its internal model/CPU breakdown is unavailable.")
            elif e["kind"] == "tool" and name in WAIT_TOOLS:
                add(lo, hi, "other", "wait", 4, [e], "reported", "Recorded wait/input-tool envelope; not evidence of busy CPU time. Async input tools may return before a human replies.")
            else:
                add(lo, hi, "cpu", "tool", 3, [e], "reported", "Recorded tool/host-work envelope. May include I/O, network waits, remote services or GPU-using tools; not measured CPU utilization.")

        previous = start
        for response in sorted((r for r in agent["rounds"] if r.get("turn_id") == turn["id"]), key=lambda r:r["time"]):
            # Avoid calling the pre-input part of a turn model inference.
            inputs = [m for m in agent["messages"] if m.get("turn_id") == turn["id"] and
                      m.get("origin") == "Human input" and previous <= m["time"] <= response["time"]]
            anchor = max([previous]+[m["time"] for m in inputs])
            add(anchor, response["time"], "gpu", "model_candidate", 1, [response]+inputs, "inferred",
                "Candidate model-wait window before a recorded response, after the preceding response or human input, excluding recorded tool/wait/compaction intervals. Includes unmeasured network, queueing and harness pre/post-processing. Neither request latency nor GPU busy time is measured.")
            previous = max(previous, response["time"])

        boundaries = sorted({start, end} | {p for c in candidates for p in (c["start"], c["end"])})
        for lo, hi in zip(boundaries, boundaries[1:]):
            active = [c for c in candidates if c["start"] <= lo and c["end"] >= hi]
            if active:
                priority = max(c["priority"] for c in active)
                chosen = [c for c in active if c["priority"] == priority]
                # Resolve an unusual wait/compaction collision deterministically.
                chosen.sort(key=lambda c: (c["phase"], c["start"]))
                winner = chosen[0]
                refs = {e["id"]:e for c in chosen for e in c["refs"]}
            else:
                winner = dict(resource="other", phase="unknown", confidence="inferred",
                              explanation="Unclassified time inside an observed turn. May include harness pre/post-processing, human input, scheduling, or missing telemetry. It is not proof of CPU work or inactivity.")
                refs = {}
            key = (winner["resource"], winner["phase"], tuple(sorted(refs)))
            if result and result[-1].get("_key") == key and result[-1]["end"] == lo and result[-1]["turn_id"] == turn["id"]:
                result[-1]["end"] = hi
                continue
            ref = next(iter(refs.values()), None)
            names = {"model_candidate":"GPU / model wait (inferred)", "tool":"CPU / tool envelope", "wait":"Other / explicit wait", "compaction":"Other / compaction", "unknown":"Other / unclassified"}
            result.append({"id":f"{agent['id']}:activity:{len(result)}", "agent_id":agent["id"], "kind":"activity",
                           "resource":winner["resource"], "phase":winner["phase"], "label":names[winner["phase"]],
                           "time":lo, "start":lo, "end":hi, "turn_id":turn["id"], "model":ref.get("model") if ref else None,
                           "confidence":winner["confidence"], "text":winner["explanation"], "text_length":len(winner["explanation"]), "truncated":False,
                           "timing":"Workflow classification only; no hardware utilization counters", "evidence_ids":sorted(refs),
                           "source":ref["source"] if ref else {"file":"Derived from observed turn boundaries", "line":0, "ordinal":None, "type":"derived_activity"}, "_key":key})
    for entry in result:
        entry.pop("_key")
    return result
