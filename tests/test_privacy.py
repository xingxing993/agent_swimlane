import unittest
from swimlane.privacy import Anonymizer


class PrivacyTests(unittest.TestCase):
    def test_content_and_identifiers_removed_attributes_retained(self):
        p=Anonymizer()
        original=dict(id='private-id',title='Secret task',text='Hello Jason 123!',time=123,length=16,
                      label='exec',source=dict(file='C:/Users/Jason/session.jsonl',line=42),
                      evidence_ids=['private-id'],usage=dict(input_tokens=123))
        result=p.transform(original)
        self.assertNotIn('Jason',str(result))
        self.assertNotIn('Secret',str(result))
        self.assertTrue(result['title'].startswith('Session '))
        self.assertEqual(len(result['text']),len(original['text']))
        self.assertEqual(result['evidence_ids'],[result['id']])
        self.assertEqual(result['usage'],original['usage'])
        self.assertEqual(result['source']['line'],42)
        self.assertEqual(result['label'],'exec')

    def test_tool_argument_structure_retained(self):
        import json
        p=Anonymizer()
        result=json.loads(p.transform('{"cmd":"read private.txt","timeout":30}', 'text'))
        self.assertEqual(set(result),{'cmd','timeout'})
        self.assertEqual(result['timeout'],30)
        self.assertEqual(len(result['cmd']),len('read private.txt'))
        self.assertNotIn('private',result['cmd'])
