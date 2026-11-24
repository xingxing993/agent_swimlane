"""Select interesting local Codex sessions and write normalized, local-only fixtures."""
import argparse
import collections
import datetime as dt
import json
import pathlib

from swimlane.codex import summarize, build_case


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--codex-home", type=pathlib.Path, default=pathlib.Path.home()/".codex")
    parser.add_argument("--output", type=pathlib.Path, default=pathlib.Path(__file__).parent/"data")
    parser.add_argument("--limit", type=int, default=5)
    parser.add_argument("--session", action="append", default=[], help="Explicit root session ID; repeatable")
    parser.add_argument("--claude-home", type=pathlib.Path, default=pathlib.Path.home()/".claude")
    parser.add_argument('--claude-limit',type=int,default=3)
    parser.add_argument('--anonymize',action='store_true',default=False)
    parser.add_argument('--progress',action='store_true')
    args = parser.parse_args()
    def progress(stage,completed,total):
        if args.progress:print(json.dumps(dict(progress=True,stage=stage,completed=completed,total=total)),flush=True)

    if args.limit < 1:
        parser.error("--limit must be positive")
    inventory, errors = {}, []
    files = sorted(p for name in ("sessions", "archived_sessions") for p in (args.codex_home/name).rglob("*") if p.name.endswith((".jsonl", ".jsonl.zst")))
    progress('Codex history detected' if files else 'No Codex history found',0,len(files))
    for file_number,path in enumerate(files,1):
        progress('Scanning Codex sessions',file_number,len(files))
        try:
            item = summarize(path)
            # Some exports repeat a thread; retain the richest available transcript.
            old = inventory.get(item["id"])
            if old is None or (item["usage_records"], item["calls"]) > (old["usage_records"], old["calls"]):
                inventory[item["id"]] = item
        except (OSError, RuntimeError, ValueError) as exc:
            errors.append({"file": str(path), "error": str(exc)})
    children = collections.defaultdict(list)
    for item in inventory.values():
        if item["parent_id"]:
            children[item["parent_id"]].append(item)
    eligible = [i for i in inventory.values() if not isinstance(i["source"], dict) and i["calls"] >= 10 and i["usage_records"] >= 3 and pathlib.Path(i.get("cwd") or "").resolve() != pathlib.Path(__file__).parent.resolve()]
    eligible.sort(key=lambda i: (bool(children[i["id"]]), len(children[i["id"]]), i.get("started") or ""), reverse=True)
    if args.session:
        missing = set(args.session)-inventory.keys()
        if missing:
            parser.error(f"Unknown session IDs: {', '.join(sorted(missing))}")
        selected = [inventory[s] for s in args.session]
    else:
        selected = eligible[:args.limit]
    args.output.mkdir(parents=True, exist_ok=True)
    index = {"schema_version": 1, "imported_at": dt.datetime.now(dt.timezone.utc).isoformat(), "scanned_files": len(files),
             "unique_sessions": len(inventory), "eligible_sessions": len(eligible), "errors": errors, "cases": [],
             "selection": "Roots with >=10 tool calls and >=3 response usage records; linked subagent cases first, then newest. Current viewer project excluded."}
    for case_number,root in enumerate(selected,1):
        progress('Extracting Codex cases',case_number,len(selected))
        members, seen = [root], {root["id"]}
        for member in members:
            for child in sorted(children[member["id"]], key=lambda c: c["started"] or ""):
                if child["id"] not in seen:
                    members.append(child)
                    seen.add(child["id"])
        case = build_case(root, members)
        name = root["id"]+".json"
        (args.output/name).write_text(json.dumps(case, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        index["cases"].append({"harness": "codex", "id": root["id"], "file": name, "title": root["title"], "started": root["started"],
                               "agents": len(members), "rounds": sum(len(a["rounds"]) for a in case["agents"]),
                               "calls": sum(sum(s["kind"] == "tool" for s in a["spans"]) for a in case["agents"]),
                               "usage": case["usage"], "edges": len(case["edges"]), "turns": len(case["agents"][0]["turns"])})
    from swimlane.claude import discover
    from swimlane.cases import assemble_case
    for root, agent in discover(args.claude_home, progress)[:args.claude_limit]:
        case = assemble_case(root, [root], [agent])
        case['limitations'].append('Claude turn ends use the last observed message before the next human prompt. Sub-agent transcript linkage is unavailable in this import; tool delegation does not create invented child lanes.')
        name = root['id']+'.json'
        (args.output/name).write_text(json.dumps(case, ensure_ascii=False, indent=2) + "\n", encoding='utf-8')
        index['cases'].append(dict(id=root['id'], file=name, title=root['title'], started=dt.datetime.fromtimestamp(agent['start']/1000,dt.timezone.utc).isoformat(), agents=1, rounds=len(agent['rounds']),calls=len(agent['spans']),usage=case['usage'],edges=0,turns=len(agent['turns']),harness='claude'))
    (args.output/"index.json").write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8")
    (args.output/"inventory.json").write_text(json.dumps(list(inventory.values()), ensure_ascii=False, indent=2), encoding="utf-8")
    if args.anonymize:
        progress('Anonymizing extracted content',0,1)
        from swimlane.privacy import anonymize_directory
        anonymize_directory(args.output)
    progress('Ready',1,1)
    if not args.progress: print(json.dumps({"scanned": len(files), "unique": len(inventory), "eligible": len(eligible), "errors": errors, "selected": index["cases"]}, ensure_ascii=True, indent=2))


if __name__ == "__main__":
    main()
