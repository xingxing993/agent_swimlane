import json
import pathlib
import unittest
from swimlane.package import build_package


class PackageTests(unittest.TestCase):
    def test_both_package_modes_preserve_local_database(self):
        root=pathlib.Path(__file__).resolve().parents[1]
        before=(root/'data/index.json').read_bytes()
        for scramble in (False,True):
            html=build_package(root,scramble)
            self.assertIn('const packagedData=',html)
            self.assertNotIn('<script src=',html)
            self.assertNotIn('<link rel="stylesheet"',html)
            data=json.loads(html.split('const packagedData=',1)[1].split(';window.fetch=',1)[0])
            index=data['/data/index.json']
            for row in index['cases']:
                case=data['/data/'+row['file']]
                self.assertEqual(case['id'],row['id'])
                ids={a['id'] for a in case['agents']}
                events={e['id'] for a in case['agents'] for e in a['rounds']+a['messages']+a['spans']+a.get('activities',[])}
                for edge in case['edges']:
                    self.assertIn(edge['from'],ids)
                    self.assertIn(edge['to'],ids)
                    if edge.get('event_id'):self.assertIn(edge['event_id'],events)
                if scramble:self.assertTrue(row['title'].startswith('Session '))
        self.assertEqual(before,(root/'data/index.json').read_bytes())
