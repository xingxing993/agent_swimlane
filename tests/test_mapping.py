import unittest
from swimlane.mapping import claude_usage


class MappingTests(unittest.TestCase):
    def test_cache_accounting_uses_common_inclusive_input(self):
        u=claude_usage(dict(input_tokens=100,cache_read_input_tokens=40,cache_creation_input_tokens=20,output_tokens=10))
        self.assertEqual(u['input_tokens'],160)
        self.assertEqual(u['cached_input_tokens'],40)
        self.assertEqual(u['total_tokens'],170)
        self.assertNotIn('reasoning_output_tokens',u)
