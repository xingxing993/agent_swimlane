import http.server
import json
import threading
import unittest
import urllib.request
from unittest.mock import patch
from serve import Handler, JOBS


class ServerTests(unittest.TestCase):
    def test_current_server_supports_import_endpoint(self):
        server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler)
        thread=threading.Thread(target=server.serve_forever,daemon=True)
        thread.start()
        base='http://127.0.0.1:'+str(server.server_port)
        try:
            with urllib.request.urlopen(base+'/api/import') as response:
                self.assertEqual(response.status,200)
                self.assertIn('status',json.load(response))
            with patch.object(JOBS,'start',return_value=True) as start:
                request=urllib.request.Request(base+'/api/import',data=b'{"scramble":false}',headers={'X-Swimlane-Import':'1','Content-Type':'application/json','Origin':base},method='POST')
                with urllib.request.urlopen(request) as response:
                    self.assertEqual(response.status,202)
                start.assert_called_once_with(False)
        finally:
            server.shutdown()
            server.server_close()
            thread.join()
