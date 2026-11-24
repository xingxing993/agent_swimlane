"""One local import job with progress; publish only completed anonymous output."""
import json
import os
import pathlib
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

    def start(self, scramble=False):
        with self.lock:
            if self.state['status']=='running':return False
            self.state={'status':'running','stage':'Detecting local history','completed':0,'total':0}
        threading.Thread(target=self.run,args=(scramble,),daemon=True).start()
        return True

    def run(self, scramble=False):
        stage=self.root/'.runtime'/('import-'+uuid.uuid4().hex)
        try:
            stage.mkdir(parents=True)
            process=subprocess.Popen([sys.executable,str(self.root/'import_history.py'),'--output',str(stage),'--limit','100000','--claude-limit','100000','--progress']+(['--anonymize'] if scramble else []),cwd=self.root,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,encoding='utf-8')
            for line in process.stdout:
                try:update=json.loads(line)
                except ValueError:continue
                if update.get('progress'):
                    with self.lock:self.state.update(update)
            _,err=process.communicate()
            if process.returncode:raise RuntimeError('Import failed; check local history readability and install requirements.txt.')
            destination=self.root/'data';destination.mkdir(exist_ok=True)
            # Index published last; old referenced files stay available until swap.
            index=json.loads((stage/'index.json').read_text(encoding='utf-8'))
            for path in stage.glob('*.json'):
                if path.name!='index.json':os.replace(path,destination/path.name)
            os.replace(stage/'index.json',destination/'index.json')
            keep={c['file'] for c in index['cases']}|{'index.json','inventory.json'}
            for path in destination.glob('*.json'):
                if path.name not in keep:path.unlink()
            stage.rmdir()
            with self.lock:self.state.update(status='complete',stage='Import complete',cases=len(index['cases']))
        except Exception as exc:
            with self.lock:self.state.update(status='failed',stage=str(exc))
