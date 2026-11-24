"""One staged local import at a time, with optional content masking."""
import json
import os
import subprocess
import sys
import threading
import uuid


class ImportJobs:
    def __init__(self, root):
        self.root=root
        self.lock=threading.Lock()
        self.state={'status':'idle'}

    def snapshot(self):
        with self.lock:return dict(self.state)

    def start(self, scramble=False, mode='incremental'):
        if mode not in ('incremental', 'full'): raise ValueError('Invalid import mode')
        with self.lock:
            if self.state['status']=='running':return False
            self.state={'status':'running','stage':'Detecting local history','completed':0,'total':0}
        threading.Thread(target=self.run,args=(scramble,mode),daemon=True).start()
        return True

    def run(self, scramble=False, mode='incremental'):
        stage=self.root/'.runtime'/('import-'+uuid.uuid4().hex)
        try:
            stage.mkdir(parents=True)
            process=subprocess.Popen([sys.executable,str(self.root/'import_history.py'),'--output',str(stage),'--progress']+(['--incremental'] if mode=='incremental' else [])+(['--anonymize'] if scramble else []),cwd=self.root,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,encoding='utf-8')
            for line in process.stdout:
                try:update=json.loads(line)
                except ValueError:continue
                if update.get('progress'):
                    with self.lock:self.state.update(update)
            _,err=process.communicate()
            if process.returncode:raise RuntimeError('Import failed; check local history readability and install requirements.txt.')
            from swimlane.config import load_config, resolve_path
            config=load_config(self.root/'config.yaml')
            destination=resolve_path(config,config['import']['output']);destination.mkdir(parents=True,exist_ok=True)
            # Index published last; old referenced files stay available until swap.
            index=json.loads((stage/'index.json').read_text(encoding='utf-8'))
            old={}
            if (destination/'index.json').exists():
                old=json.loads((destination/'index.json').read_text(encoding='utf-8'))
            for row in index['cases']: row['local_import']=True
            if old:
                new_ids={c['id'] for c in index['cases']}
                index['cases'].extend(c for c in old['cases'] if c['id'] not in new_ids and not c.get('local_import',True))
            (stage/'index.json').write_text(json.dumps(index),encoding='utf-8')
            for path in stage.glob('*.json'):
                if path.name!='index.json':os.replace(path,destination/path.name)
            os.replace(stage/'index.json',destination/'index.json')
            keep={c['file'] for c in index['cases']}|{'index.json','inventory.json'}
            # Never remove user-provided datasets. Only obsolete files owned by
            # the previous index are candidates for a ground-up replacement.
            for row in old.get('cases',[]):
                path=destination/row['file']
                if row.get('local_import',True) and path.name not in keep and path.resolve().parent==destination.resolve():
                    path.unlink(missing_ok=True)
            stage.rmdir()
            with self.lock:self.state.update(status='complete',stage='Import complete',cases=len(index['cases']))
        except Exception as exc:
            with self.lock:self.state.update(status='failed',stage=str(exc))
