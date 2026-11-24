import copy
import json
import pathlib
import unittest
import uuid
from unittest.mock import patch
from swimlane.config import load_config
from swimlane.history import import_history
from swimlane.cases import assemble_case
from serve import library_index


class HistoryTests(unittest.TestCase):
    def setUp(self):
        self.root=pathlib.Path(__file__).resolve().parents[1]/'.runtime'/'tests'/str(uuid.uuid4())
        self.source=self.root/'source';self.source.mkdir(parents=True)
        self.output=self.root/'out';self.cache=self.root/'cache.json'
        self.config=load_config();self.config['_base']=self.root
        rules=self.config['import'];rules['exclude_current_project']=False
        rules['sources']['claude']['enabled']=False
        rules['sources']['codex'].update(home=str(self.source),directories=['.'],patterns=['*.jsonl'],min_calls=0,min_responses=0)
        (self.source/'a.jsonl').write_text('first')

    def tearDown(self):
        # Verified workspace-owned test directory; use one filesystem API throughout.
        import shutil
        assert self.root.resolve().is_relative_to(pathlib.Path(__file__).resolve().parents[1]/'.runtime'/'tests')
        shutil.rmtree(self.root)

    def read(self,path):
        agent=dict(id=path.stem,harness='codex',path='/root',parent_id=None,start=0,end=100,
                   rounds=[],spans=[],messages=[],turns=[],activities=[])
        return dict(id=path.stem,title='test',path=str(path),started='2026',calls=0,usage_records=0,parent_id=None,agent=agent)

    def test_incremental_reuses_unchanged_records_and_refresh_bypasses_cache(self):
        def build(root,members): return assemble_case(root,members,[copy.deepcopy(m['agent']) for m in members])
        with patch.dict('swimlane.history.ADAPTERS',codex=(self.read,build)):
            import_history(self.config,self.output,cache_path=self.cache)
        with patch('swimlane.history.ADAPTERS',{'codex':(lambda p:self.fail('unchanged file reread'),build)}):
            index=import_history(self.config,self.output,incremental=True,cache_path=self.cache)
            self.assertEqual(len(index['cases']),1)
        with patch('swimlane.history.ADAPTERS',{'codex':(self.read,build)}):
            (self.source/'b.jsonl').write_text('new')
            index=import_history(self.config,self.output,incremental=True,cache_path=self.cache)
            self.assertEqual(len(index['cases']),2)
            self.config['import']['sources']['codex']['min_calls']=1
            self.assertFalse(import_history(self.config,self.output,cache_path=self.cache)['cases'])

    def test_library_discovers_unindexed_cases_and_reports_broken_files(self):
        self.output.mkdir()
        case=assemble_case(self.read(self.source/'a.jsonl'),[],[self.read(self.source/'a.jsonl')['agent']])
        (self.output/'shared.json').write_text(json.dumps(case))
        (self.output/'broken.json').write_text('{')
        with patch('serve.data_path',return_value=self.output):
            index=library_index()
        self.assertEqual(index['cases'][0]['file'],'shared.json')
        self.assertEqual(len(index['errors']),1)
