"""Everything that has to be true before Byline is published, in one command.

    python interop/preflight.py                       the full gate
    python interop/preflight.py --quick               skip the browsers and the harnesses
    python interop/preflight.py --engines firefox,chrome   name the engines to demand

Naming engines is how you record that one is unavailable rather than quietly
ignoring it: the line says which were asked for, so a green gate never implies
an engine that never ran.

Prints one line per check and exits non-zero on the first thing that is not
true. The point is a single answer to "is this publishable", rather than eight
separate calls whose results have to be held in someone's head.
"""
import os, re, shutil, subprocess, sys, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INTEROP = os.path.join(ROOT, 'interop')
PY = sys.executable
HARNESSES = ['verify.mjs', 'verify-formats.mjs', 'verify-oid4vp.mjs', 'verify-wallet.mjs',
             'verify-sdjwt.mjs', 'verify-rdfc.mjs', 'verify-oid4vci.mjs', 'relay-test.mjs', 'verify-nipoa.py']

failures = []


def check(name, fn):
    t0 = time.time()
    try:
        detail = fn()
        ok, detail = (True, detail) if not isinstance(detail, tuple) else detail
    except Exception as e:
        ok, detail = False, str(e)
    mark = ' ok ' if ok else 'FAIL'
    print(f'  [{mark}] {name:44} {detail or ""}  ({time.time() - t0:.0f}s)')
    if not ok:
        failures.append(name)
    return ok


def run(argv, cwd=ROOT, timeout=600):
    r = subprocess.run(argv, capture_output=True, text=True, cwd=cwd, timeout=timeout)
    return r.returncode, (r.stdout or '') + (r.stderr or '')


def app_bytes():
    return open(os.path.join(ROOT, 'byline.html'), 'rb').read()


def main():
    quick = '--quick' in sys.argv
    engines = ''
    if '--engines' in sys.argv:
        engines = sys.argv[sys.argv.index('--engines') + 1]
    print('\nthe file')
    check('no CRLF line endings', lambda: (b'\r\n' not in app_bytes(), 'LF throughout'))
    check('no raw NUL bytes', lambda: (b'\x00' not in app_bytes(), 'none'))
    check('exactly one inline script', lambda: (
        len(re.findall(rb'<script>', app_bytes())) == 1, 'one'))

    def csp():
        code, out = run([PY, os.path.join(INTEROP, 'csp-hash.py'), '--check'])
        return code == 0, out.strip().splitlines()[-1] if out.strip() else ''
    check('the Content-Security-Policy hash is current', csp)

    def parses():
        code, out = run([PY, os.path.join(INTEROP, 'dev.py'), 'check'])
        return code == 0, out.strip().splitlines()[-1] if out.strip() else ''
    check('the script parses', parses)

    print('\nthe prose')

    def counts():
        code, out = run([PY, os.path.join(INTEROP, 'counts.py')] + ([] if quick else ['--run']))
        last = [l for l in out.strip().splitlines() if l.strip()]
        return code == 0, last[-1] if last else ''
    check('the numbers match the code', counts)

    if quick:
        print('\nskipped: browsers and harnesses (--quick)')
    else:
        print('\nthe browsers')

        def suite():
            argv = [PY, os.path.join(INTEROP, 'run-suite.py')] + (engines.split(',') if engines else [])
            code, out = run(argv, timeout=900)
            lines = [l.strip() for l in out.splitlines() if 'pass,' in l or 'FAIL' in l or 'NO VERDICT' in l]
            return code == 0, '; '.join(lines) if lines else out.strip()[:120]
        check(('engines: ' + engines) if engines else 'every engine on this machine', suite)
        # the same run again at a phone window, where the layout tests are real
        def mobile():
            argv = [PY, os.path.join(INTEROP, 'run-suite.py'), '--mobile'] + (engines.split(',') if engines else [])
            code, out = run(argv, timeout=900)
            lines = [l.strip() for l in out.splitlines() if 'pass,' in l or 'FAIL' in l or 'NOT RUN' in l]
            return code == 0, '; '.join(lines) if lines else out.strip()[:120]
        check('the same, at a phone window', mobile)

        print('\nthe harnesses')
        for h in HARNESSES:
            if not os.path.exists(os.path.join(INTEROP, h)):
                continue

            def one(h=h):
                code, out = run([PY if h.endswith('.py') else 'node', h], cwd=INTEROP, timeout=300)
                n = len(re.findall(r'^\s+(PASS|✓)', out, re.M))
                fails = re.findall(r'^\s+(FAIL|✕).*', out, re.M)
                return code == 0, (f'{n} checks' if code == 0 else (fails[0][:80] if fails else out.strip()[-120:]))
            check(h, one)

    print()
    if failures:
        print(f'NOT PUBLISHABLE — {len(failures)} check(s) failed: ' + ', '.join(failures))
        return 1
    print('publishable: everything that can be checked here is true')
    return 0


if __name__ == '__main__':
    sys.exit(main())
