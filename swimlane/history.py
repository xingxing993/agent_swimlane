"""Configurable discovery and selection across registered history adapters."""
import collections
import datetime as dt
import json
import pathlib
from swimlane import codex, claude
from swimlane.cases import assemble_case
from swimlane.config import resolve_path
from swimlane.activity import derive_activity


def case_row(case, filename):
    agents = case['agents']
    return dict(id=case['id'], file=filename, title=case['title'], harness=case['harness'],
                started=dt.datetime.fromtimestamp(case['start']/1000, dt.timezone.utc).isoformat(),
                agents=len(agents), rounds=sum(len(a['rounds']) for a in agents),
                calls=sum(s['kind']=='tool' for a in agents for s in a['spans']),
                usage=case['usage'], edges=len(case['edges']), turns=len(agents[0]['turns']))


def read_claude(path):
    agent, title = claude.normalize(path)
    return dict(id=agent['id'], title=title or path.stem, path=str(path), started=agent['start'],
                parent_id=None, cwd=agent.get('cwd'), calls=sum(s['kind']=='tool' for s in agent['spans']),
                usage_records=len(agent['rounds']), agent=agent)


def build_claude(root, members):
    case = assemble_case(root, members, [m['agent'] for m in members])
    case['limitations'].append('Claude child transcript linkage is unavailable; delegation does not create invented child lanes.')
    return case


def read_codex(path):
    item = codex.summarize(path)
    return item


def build_codex(root, members):
    for member in members:
        if 'agent' not in member: member['agent']=codex.normalize(pathlib.Path(member['path']))
    return assemble_case(root, members, [m['agent'] for m in members])


ADAPTERS = {'codex': (read_codex, build_codex), 'claude': (read_claude, build_claude)}


def import_history(config, output, progress=lambda *args: None, incremental=False, cache_path=None):
    rules = config['import']
    old_cache = {}
    if incremental and cache_path and cache_path.exists():
        try: old_cache = json.loads(cache_path.read_text(encoding='utf-8'))
        except (OSError, ValueError): pass
    cache, inventory, cases, errors = {}, [], [], []
    scanned = eligible_count = 0
    requested = set(rules['sessions']); found_ids = set()
    for harness, options in rules['sources'].items():
        if not options['enabled']: continue
        read, build = ADAPTERS[harness]
        home = resolve_path(config, options['home'])
        paths = sorted({p for directory in options['directories'] for pattern in options['patterns']
                        for p in (home/directory).rglob(pattern)
                        if p.is_file() and not set(options.get('excluded_parts', [])) & set(p.parts)})
        discovered = {}
        for number, path in enumerate(paths, 1):
            progress('Scanning '+harness, number, len(paths)); scanned += 1
            try:
                stat = path.stat(); key = harness+':'+str(path)
                signature = [stat.st_mtime_ns, stat.st_size]; cached = old_cache.get(key)
                item = cached['item'] if cached and cached['signature']==signature else read(path)
                cache[key] = dict(signature=signature, item=item)
                old = discovered.get(item['id'])
                if old is None or (item['usage_records'], item['calls']) > (old['usage_records'], old['calls']):
                    discovered[item['id']] = item
            except (OSError, RuntimeError, ValueError) as exc:
                errors.append(dict(file=str(path), error=str(exc)))
        found_ids.update(discovered)
        children = collections.defaultdict(list)
        for item in discovered.values():
            if item.get('parent_id'): children[item['parent_id']].append(item)
        def eligible(item):
            cwd = item.get('cwd')
            excluded = [resolve_path(config, p) for p in rules['excluded_paths']]
            if rules['exclude_current_project']: excluded.append(config['_base'])
            return (not item.get('parent_id') and not isinstance(item.get('source'), dict)
                    and item['calls'] >= options['min_calls'] and item['usage_records'] >= options['min_responses']
                    and (not cwd or pathlib.Path(cwd).resolve() not in excluded))
        candidates = [i for i in discovered.values() if eligible(i)]
        candidates.sort(key=lambda i: (len(children[i['id']]) if rules['prefer_subagents'] else 0, str(i.get('started') or '')), reverse=True)
        eligible_count += len(candidates)
        selected = [i for i in discovered.values() if i['id'] in requested] if requested else candidates[:options['limit']]
        inventory.extend(dict(harness=harness, **{k:v for k,v in i.items() if k!='agent'}) for i in discovered.values())
        for number, root in enumerate(selected, 1):
            progress('Extracting '+harness, number, len(selected))
            members, seen = [root], {root['id']}
            for member in members:
                for child in children[member['id']]:
                    if child['id'] not in seen: members.append(child); seen.add(child['id'])
            case = build(root, members)
            case['timing_policy'] = config['timing']
            for agent in case['agents']:
                agent['activities'] = derive_activity(agent, config['timing']['silence_seconds']*1000)
            cases.append(case)
    if requested-found_ids: raise ValueError('Unknown session IDs: '+', '.join(sorted(requested-found_ids)))
    output.mkdir(parents=True, exist_ok=True)
    index = dict(schema_version=1, imported_at=dt.datetime.now(dt.timezone.utc).isoformat(),
                 scanned_files=scanned, unique_sessions=len(inventory), eligible_sessions=eligible_count,
                 errors=errors, cases=[], selection='Selection rules from config.yaml', timing_policy=config['timing'])
    for case in cases:
        filename = case['id']+'.json'
        if pathlib.Path(filename).name != filename or '/' in filename or '\\' in filename:
            raise ValueError('Unsafe session ID')
        (output/filename).write_text(json.dumps(case, ensure_ascii=False), encoding='utf-8')
        index['cases'].append(case_row(case, filename))
    (output/'index.json').write_text(json.dumps(index), encoding='utf-8')
    (output/'inventory.json').write_text(json.dumps(inventory), encoding='utf-8')
    if cache_path:
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        temporary = cache_path.with_suffix('.tmp')
        temporary.write_text(json.dumps(cache), encoding='utf-8'); temporary.replace(cache_path)
    return index
