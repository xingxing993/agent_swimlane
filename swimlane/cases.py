"""Common case assembly, independent of source naming."""
import collections
from swimlane.activity import derive_activity

def assemble_case(root, members, agents):
    for agent in agents:
        agent["activities"] = derive_activity(agent)
    by_path = {a["path"]: a["id"] for a in agents}
    edges = []
    for a in agents:
        for s in a["spans"]:
            if s["kind"] == "lifecycle" and s["label"] == "started" and s.get("target_agent_id"):
                edges.append({"id": s["id"], "kind": "spawn", "from": a["id"], "to": s["target_agent_id"], "time": s["time"], "event_id": s["id"], "confidence": "reported"})
        for msg in a["messages"]:
            if msg["kind"] == "message":
                author = by_path.get(msg.get("author"))
                recipient = by_path.get(msg.get("recipient"))
                if author and recipient and recipient == a["id"]:
                    edges.append({"id": msg["id"], "kind": "report" if msg["label"] == "Report received" else "message",
                                  "from": author, "to": recipient, "time": msg["time"], "event_id": msg["id"], "confidence": "reported"})
    for a in agents[1:]:
        if a["parent_id"] and not any(e["kind"] == "spawn" and e["to"] == a["id"] for e in edges):
            edges.append({"id": f"parent-{a['id']}", "kind": "spawn", "from": a["parent_id"], "to": a["id"],
                          "time": a["start"], "event_id": None, "confidence": "inferred"})
    total = collections.Counter()
    for a in agents:
        for r in a["rounds"]:
            total.update({k: v for k, v in r["usage"].items() if isinstance(v, (int, float))})
    collaboration = [s for a in agents[1:] for s in a["turns"]]
    focus = None
    if collaboration:
        # First collaboration turn, not later resumed work days away.
        first_start = min(t["start"] for t in collaboration)
        group = [t for t in collaboration if t["start"] <= first_start + 120000]
        focus = [first_start-30000, max(t["end"] or t["start"] for t in group)+60000]
    return {"schema_version": 1, "id": root["id"], "title": root["title"], "harness": agents[0]["harness"], "agents": agents,
            "start": min(a["start"] for a in agents), "end": max(a["end"] for a in agents), "edges": edges,
            "focus": focus, "usage": dict(total), "source_files": [m["path"] for m in members],
            "limitations": ["Response markers use usage-record timestamps, not request start times. GPU/model-wait bands are inferred workflow windows, not measured inference latency or hardware utilization.",
                            "CPU/tool bands use recorded tool envelopes; preprocessing and postprocessing cannot be isolated and remain unclassified or inside inferred model-wait windows.",
                            "Tool spans show recorded call/output boundaries. Nested executions are separate and must not be added to tool-call counts.",
                            "Content composition counts visible characters once in the stored transcript, not tokens in each model input.",
                            "Encrypted content is unavailable. Inspector previews are capped at 18,000 characters.",
                            "A completed turn or delivered report does not prove the agent process terminated."]}
