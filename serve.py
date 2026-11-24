"""Serve only viewer assets and normalized cases on loopback."""
import argparse
import json
from swimlane.import_jobs import ImportJobs
import http.server
import pathlib
from urllib.parse import unquote, urlsplit

ROOT = pathlib.Path(__file__).resolve().parent


JOBS = ImportJobs(ROOT)

class Handler(http.server.SimpleHTTPRequestHandler):
    def json_response(self, value, status=200):
        body=json.dumps(value).encode()
        self.send_response(status)
        self.send_header('Content-Type','application/json')
        self.send_header('Content-Length',str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == '/api/import':
            return self.json_response(JOBS.snapshot())
        return super().do_GET()

    def do_POST(self):
        # Only same-origin local UI can start disk-reading work.
        origin=self.headers.get('Origin')
        host=self.headers.get('Host','')
        if self.path not in ('/api/import','/api/package') or self.headers.get('X-Swimlane-Import')!='1' or (origin and origin!='http://'+host):
            return self.json_response({'error':'Unsupported request'},403)
        length=int(self.headers.get('Content-Length','0'))
        if length>1024:return self.json_response({'error':'Request too large'},400)
        try: options=json.loads(self.rfile.read(length) or b'{}')
        except ValueError:return self.json_response({'error':'Invalid JSON'},400)
        if self.path=='/api/package':
            from swimlane.package import build_package
            body=build_package(ROOT,options.get('scramble') is True).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type','text/html; charset=utf-8')
            self.send_header('Content-Disposition','attachment; filename="agent-swimlane.html"')
            self.send_header('Content-Length',str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        started=JOBS.start(options.get('scramble') is True)
        return self.json_response(JOBS.snapshot(),202 if started else 409)

    def translate_path(self, path):
        path = unquote(urlsplit(path).path)
        if path.startswith("/data/"):
            base, relative = ROOT/"data", path[6:]
        else:
            base, relative = ROOT/"web", path.lstrip("/") or "index.html"
        resolved = (base/relative).resolve()
        if not resolved.is_relative_to(base.resolve()):
            return str(ROOT/"web"/"__not_found__")
        return str(resolved)

    def list_directory(self, path):
        self.send_error(404)
        return None

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'")
        super().end_headers()


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--port", type=int, default=8765)
    args = p.parse_args()
    server = http.server.ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"Agent Swimlane: http://127.0.0.1:{args.port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.server_close()
