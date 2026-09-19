"""Serves the app and collects test verdicts POSTed to /report.

    python interop/report-server.py 8124
    firefox --headless "http://127.0.0.1:8124/byline.html?test=1&report=http://127.0.0.1:8124/report"

Each verdict is appended to interop/_reports.jsonl. Exists so a browser with no
driver attached — a second engine, a phone — can still run the suite and hand
back what happened.
"""
import json, os, sys, time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'interop', '_reports.jsonl')
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8124


class H(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def do_POST(self):
        if self.path.split('?')[0] != '/report':
            self.send_response(404); self.end_headers(); return
        n = int(self.headers.get('content-length') or 0)
        body = self.rfile.read(n).decode('utf-8', 'replace')
        try:
            rec = json.loads(body)
        except Exception:
            rec = {'raw': body}
        rec['received'] = time.strftime('%Y-%m-%dT%H:%M:%S')
        with open(OUT, 'a', encoding='utf-8') as f:
            f.write(json.dumps(rec) + '\n')
        self.send_response(204); self.end_headers()

    def log_message(self, *a):
        pass


if __name__ == '__main__':
    ThreadingHTTPServer(('127.0.0.1', PORT), H).serve_forever()
