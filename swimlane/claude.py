"""Claude Code CLI transcript adapter; consumes only saved local records."""
import collections
from swimlane.codex import read_events, millis, content_text, clean, prompt_title
from swimlane.mapping import CLAUDE_BLOCKS, claude_usage


def normalize(path):
    records = list(read_events(path))
    sid = 'claude-'+path.stem
    a = dict(id=sid, harness='claude', path='/root', parent_id=None, nickname=None, cli_version=None,
             turns=[], rounds=[], spans=[], messages=[], content_chars={}, notices=[])
    calls, responses, seen = {}, {}, set()
    turn = None
    title = ''
    for e in records:
        typ=e.get('type'); msg=e.get('message') or {}; t=millis(e.get('timestamp'))
        if typ not in ('user','assistant') or not t: continue
        blocks=msg.get('content',[])
        if isinstance(blocks,str): blocks=[dict(type='text',text=blocks)]
        human=typ=='user' and any(b.get('type')=='text' for b in blocks) and not any(b.get('type')=='tool_result' for b in blocks) and not e.get('isMeta')
        if human:
            text=content_text(blocks)
            turn=dict(id=e.get('uuid',str(e['line'])),start=t,end=t,title=prompt_title(text)[:140],agent_id=sid)
            a['turns'].append(turn)
            if not title:title=prompt_title(text)
        if turn is None:
            turn=dict(id='initial',start=t,end=t,title='Transcript continuation',agent_id=sid);a['turns'].append(turn)
        turn['end']=max(turn['end'],t)
        def event(kind,label,text='',**extra):
            text=clean(text)
            return dict(id=f'{sid}:{e["line"]}:{kind}:{len(a["messages"])+len(a["spans"])}',agent_id=sid,kind=kind,label=label,time=t,turn_id=turn['id'],model=msg.get('model'),text=text[:18000],text_length=len(text),truncated=len(text)>18000,confidence='reported',source=dict(file=str(path),line=e['line'],ordinal=None,type=typ),**extra)
        if typ=='assistant' and msg.get('id') and msg.get('usage') is not None:
            rid=msg['id'];u=claude_usage(msg['usage'])
            if rid not in responses:
                r=event('round','Model response',usage=u,response_id=rid,timing='Assistant transcript timestamp; request start unavailable');responses[rid]=r;a['rounds'].append(r)
            else:
                # Multiple content blocks can repeat one API response. Keep maximum counters once.
                r=responses[rid]
                for k,v in u.items():r['usage'][k]=max(r['usage'].get(k,0),v)
        for b in blocks:
            kind=CLAUDE_BLOCKS.get(b.get('type'))
            identity=(e.get('uuid',e['line']),b.get('id'),b.get('type'),str(b.get('text','')))
            if identity in seen:continue
            seen.add(identity)
            if kind=='tool':
                c=event('tool',b.get('name','tool'),clean(b.get('input',{})),call_id=b.get('id'),start=t,end=None,timing='Tool-use block to tool-result transcript timestamps');a['spans'].append(c);calls[b.get('id')]=c
            elif kind=='tool_output':
                c=calls.get(b.get('tool_use_id'));text=content_text(b.get('content',[]))
                if c:c.update(end=t,output=text[:18000],output_length=len(text),output_truncated=len(text)>18000)
            elif kind=='text':
                origin='Human input' if human else 'Assistant text' if typ=='assistant' else 'User-role context'
                text=b.get('text','');a['messages'].append(event('text',typ.title(),text,role=typ,origin=origin))
                a['content_chars'][origin]=a['content_chars'].get(origin,0)+len(text)
    for i,r in enumerate(a['rounds'],1):r.update(number=i,label=f'Response {i}')
    times=[m['start'] for m in a['turns']]+[m['end'] for m in a['turns']]
    a.update(start=min(times,default=0),end=max(times,default=0))
    return a,title


def discover(home, progress=None):
    found=[]
    paths=sorted((home/'projects').rglob('*.jsonl'))
    if progress:progress('Claude Code history detected' if paths else 'No Claude Code history found',0,len(paths))
    for number,path in enumerate(paths,1):
        if progress:progress('Scanning Claude Code sessions',number,len(paths))
        if 'subagents' in path.parts:continue
        try:
            a,title=normalize(path)
            if len(a['rounds'])>=3 and len(a['spans'])>=3:
                found.append((dict(id=a['id'],title=title or path.stem,path=str(path),started=a['start']),a))
        except (ValueError,OSError):continue
    return sorted(found,key=lambda x:x[1]['start'],reverse=True)
