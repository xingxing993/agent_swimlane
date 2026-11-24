"""Length-preserving content scrambling and stable per-export pseudonyms."""
import hashlib
import hmac
import json
import secrets


class Anonymizer:
    def __init__(self):
        self.key = secrets.token_bytes(32)

    def alias(self, value):
        return hmac.new(self.key, value.encode(), hashlib.sha256).hexdigest()[:24]

    def scramble(self, text):
        # Preserve character count, whitespace and punctuation; replace letters
        # and digits. This is masking, not reversible substitution encryption.
        return ''.join('x' if c.isalpha() else '0' if c.isdigit() else c for c in text)

    def body(self, value):
        if isinstance(value, dict):
            return {k:self.body(v) for k,v in value.items()}
        if isinstance(value, list):
            return [self.body(v) for v in value]
        return self.scramble(value) if isinstance(value,str) else value

    def transform(self, value, key=''):
        if isinstance(value, dict):
            return {k:self.transform(v,k) for k,v in value.items()}
        if isinstance(value,list):
            return [self.transform(v,key) for v in value]
        if not isinstance(value,str):
            return value
        if key in ('id','agent_id','parent_id','turn_id','response_id','call_id','event_id','from','to','evidence_ids','parent_thread_id'):
            return self.alias(value)
        if key == 'file':
            return self.alias(value[:-5])+'.json' if value.endswith('.json') else 'source-'+self.alias(value)
        if key in ('path','author','recipient','agent_path','target_path','target','nickname','task_name'):
            return '/root' if value=='/root' else '/root/agent-'+self.alias(value)[:8]
        if key in ('cwd','source_files'):
            return 'source-'+self.alias(value)
        if key == 'title':
            return 'Session '+self.alias(value)[:12]
        if key in ('text','output','title','prompt','message','arguments','input','error'):
            try:
                parsed=json.loads(value)
            except (ValueError,TypeError):
                return self.scramble(value)
            # Preserve JSON field names, numeric attributes and container shape.
            return json.dumps(self.body(parsed),ensure_ascii=False)
        return value


def anonymize_directory(directory):
    privacy=Anonymizer()
    files=list(directory.glob('*.json'))
    converted=[]
    for path in files:
        value=json.loads(path.read_text(encoding='utf-8'))
        result=privacy.transform(value)
        if isinstance(result,dict) and 'agents' in result:
            result['title']='Session '+result['id'][:12]
        if isinstance(result,dict) and 'cases' in result:
            for case in result['cases']:
                case['title']='Session '+case['id'][:12]
        if isinstance(result,dict):
            result['anonymization']={'mode':'content-masked','note':'Prose and string argument values masked; tool names, JSON keys, numeric profiling attributes and timestamps retained. Not a guarantee against inference from metadata.'}
        name=path.name if path.name in ('index.json','inventory.json') else privacy.alias(path.stem)+'.json'
        converted.append((name,result))
    # Work only in a newly staged output directory.
    for path in files:path.unlink()
    for name,value in converted:
        (directory/name).write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
