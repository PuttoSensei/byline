"""Run byline.html's smoke tests headlessly and print one line per engine.

Reading the suite through the browser pane was the single most expensive
thing in a working session: a hidden pane throttles background timers, so
polling loops time out and each snapshot costs a round trip. Every browser
here can run the suite with nothing driving it and POST the verdict back —
that is what ?report= is for. This serves the file, collects the verdicts,
and prints them.

    python interop/run-suite.py                 every engine it can find
    python interop/run-suite.py firefox         just one
    python interop/run-suite.py --only Formats  one slice of the suite
    python interop/run-suite.py --list          which engines are on this machine
    python interop/run-suite.py --timeout 240   per-engine deadline in seconds
    python interop/run-suite.py --mobile       every engine at a phone window (390x844)

--mobile is what makes the "On a phone" tests real. They measure the actual
layout, so at a desktop width they report what they would have checked instead
of passing — a layout test that never ran is not a pass.

Exit code is the number of failing tests, capped at 125, so `&&` works.
Failures are printed with their group, name and detail — the same text the
in-page report shows.
"""
import json, os, shutil, socket, subprocess, sys, tempfile, threading, time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOCAL = os.environ.get('LOCALAPPDATA', '')
HOME = os.path.expanduser('~')
PROGRAM_FILES = os.environ.get('ProgramFiles', r'C:\Program Files')
PF86 = os.environ.get('ProgramFiles(x86)', r'C:\Program Files (x86)')

# Firefox on this machine lives in the profile root, not AppData\Local, where
# it fails with a side-by-side error; both are listed so the script keeps
# working if that is ever repaired.
ENGINES = [
    ('firefox', [os.path.join(HOME, 'Mozilla Firefox', 'firefox.exe'),
                 os.path.join(LOCAL, 'Mozilla Firefox', 'firefox.exe'),
                 os.path.join(PROGRAM_FILES, 'Mozilla Firefox', 'firefox.exe')],
     lambda exe, url, prof, size: [exe, '--headless', '--no-remote', '-profile', prof]
            + (['--window-size=' + size] if size else []) + [url]),
    ('chrome', [os.path.join(PROGRAM_FILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
                os.path.join(PF86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
                os.path.join(LOCAL, 'Google', 'Chrome', 'Application', 'chrome.exe')],
     lambda exe, url, prof, size: [exe, '--headless=new', '--disable-gpu', '--no-first-run',
                             '--user-data-dir=' + prof] + (['--window-size=' + size.replace('x', ',')] if size else []) + [url]),
    ('edge', [os.path.join(PF86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
              os.path.join(PROGRAM_FILES, 'Microsoft', 'Edge', 'Application', 'msedge.exe')],
     lambda exe, url, prof, size: [exe, '--headless=new', '--disable-gpu', '--no-first-run',
                             '--user-data-dir=' + prof] + (['--window-size=' + size.replace('x', ',')] if size else []) + [url]),
]
PHONE = '390x844'


def found():
    out = []
    for name, paths, argv in ENGINES:
        exe = next((p for p in paths if os.path.exists(p)), None) or shutil.which(name)
        if exe:
            out.append((name, exe, argv))
    return out


def kill_tree(proc):
    """A browser launcher spawns a tree of renderer and GPU processes, and
    killing the parent leaves the rest running. Twenty stranded Edge processes
    once accumulated across runs until the next launch never reported at all."""
    try:
        if os.name == 'nt':
            subprocess.run(['taskkill', '/T', '/F', '/PID', str(proc.pid)],
                           capture_output=True, timeout=30)
        else:
            proc.kill()
    except Exception:
        pass
    try:
        proc.wait(timeout=10)
    except Exception:
        pass


def csp_is_current():
    """A stale Content-Security-Policy hash makes the browser refuse the inline
    script, so the page loads and nothing runs — which from out here is
    indistinguishable from a hang. Three "flaky hangs" were this, every time.
    Check it before blaming the browser."""
    r = subprocess.run([sys.executable, os.path.join(ROOT, 'interop', 'csp-hash.py'), '--check'],
                       capture_output=True, text=True)
    return r.returncode == 0


def free_port():
    s = socket.socket()
    s.bind(('127.0.0.1', 0))
    p = s.getsockname()[1]
    s.close()
    return p


class Collector(SimpleHTTPRequestHandler):
    verdicts = {}
    lock = threading.Lock()

    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def do_POST(self):
        n = int(self.headers.get('content-length') or 0)
        try:
            rec = json.loads(self.rfile.read(n).decode('utf-8', 'replace'))
        except Exception:
            rec = {'raw': True}
        who = self.path.rsplit('/', 1)[-1] or 'unknown'
        with Collector.lock:
            Collector.verdicts[who] = rec
        self.send_response(204)
        self.end_headers()

    def log_message(self, *a):
        pass


def run(name, exe, argv, port, only, timeout, size=None):
    url = f'http://127.0.0.1:{port}/byline.html?test=1&report=http://127.0.0.1:{port}/report/{name}'
    if only:
        url += '&only=' + only
    url += f'&v={int(time.time())}'
    prof = tempfile.mkdtemp(prefix='byline-' + name + '-')
    proc = subprocess.Popen(argv(exe, url, prof, size), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    started = time.time()
    deadline = started + timeout
    try:
        while time.time() < deadline:
            with Collector.lock:
                if name in Collector.verdicts:
                    return Collector.verdicts[name]
            if proc.poll() is not None:
                # a browser that exits at once has not run the page at all:
                # headless unavailable, a policy, or a broken install
                early = time.time() - started
                if early < 20:
                    return {'gone': f'exited after {early:.0f}s without loading the page — '
                                    f'headless {name} is not working on this machine'}
                break
            time.sleep(0.5)
        return None
    finally:
        kill_tree(proc)
        shutil.rmtree(prof, ignore_errors=True)


def main():
    args = sys.argv[1:]
    only = None
    timeout = 180
    size = PHONE if '--mobile' in args else None
    if '--list' in args:
        for name, exe, _ in found():
            print(f'{name:8} {exe}')
        return 0
    if '--only' in args:
        i = args.index('--only')
        only = args[i + 1]
        del args[i:i + 2]
    if '--timeout' in args:
        i = args.index('--timeout')
        timeout = int(args[i + 1])
        del args[i:i + 2]
    wanted = [a for a in args if not a.startswith('-')]

    if not csp_is_current():
        for line in [
            'REFUSING TO RUN: the Content-Security-Policy hash is stale.',
            '  The browser will refuse the inline script, so every engine loads the',
            '  page, runs nothing, and reports nothing — which looks exactly like a',
            '  hang. Run:  python interop/csp-hash.py',
        ]:
            print(line, file=sys.stderr)
        return 125

    engines = [e for e in found() if not wanted or e[0] in wanted]
    if not engines:
        print('no browser found — try --list', file=sys.stderr)
        return 125

    if size:
        print(f'(phone window: {size})')
    port = free_port()
    srv = ThreadingHTTPServer(('127.0.0.1', port), Collector)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    total_fail = 0
    try:
        for name, exe, argv in engines:
            t0 = time.time()
            v = run(name, exe, argv, port, only, timeout, size)
            if v is None:
                print(f'{name:8} NO VERDICT after {timeout}s — it loaded but never reported')
                total_fail += 1
                continue
            if v.get('gone'):
                print(f'{name:8} NOT RUN — {v["gone"]}')
                total_fail += 1
                continue
            p, f = v.get('pass', 0), v.get('fail', 0)
            ua = (v.get('ua') or '').split(') ')[-1] or '?'
            stuck = f' — INCOMPLETE, stuck in {v.get("stuckIn")}' if v.get('incomplete') else ''
            print(f'{name:8} {p} pass, {f} fail   ({ua}, {time.time() - t0:.0f}s){stuck}')
            if v.get('incomplete'):
                total_fail += 1
            for fl in v.get('failures') or []:
                print(f'         FAIL {fl.get("group")} / {fl.get("name")}: {fl.get("detail")}')
            total_fail += f
    finally:
        srv.shutdown()
    return min(total_fail, 125)


if __name__ == '__main__':
    sys.exit(main())
