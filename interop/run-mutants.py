"""Run the mutants falsify-app.mjs writes, headlessly, and say which survived.

    node interop/falsify-app.mjs               write the mutants to ../_mutants/
    python interop/run-mutants.py              run every one, in Chrome
    python interop/run-mutants.py <id> <id>    just these
    python interop/run-mutants.py --engine firefox

The mutants used to be driven in an iframe from the real page, by hand, which
is why three needles went stale without anyone noticing: nothing made running
them cheap. Each mutant gets a throwaway tree of its own — run-suite.py and
csp-hash.py find byline.html relative to themselves, so copies of them placed
beside the mutant act on the mutant and never on the real file. A mutant's
script differs from the original by construction, so its CSP hash is stamped
there too; unstamped, the browser refuses the script and nothing runs, which
from out here looks exactly like a kill.

A kill is a run in which a test FAILED. An engine that did not run is not a
kill, and neither is a run with no FAIL line in it; both are reported as
NOT JUDGED and count against the exit code like a survivor.

Exit code is the number of mutants that were not killed.
"""
import json, os, shutil, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, '_mutants')


def main():
    args = sys.argv[1:]
    engine = 'chrome'
    if '--engine' in args:
        i = args.index('--engine')
        engine = args[i + 1]
        del args[i:i + 2]
    manifest = os.path.join(OUT, 'manifest.json')
    if not os.path.exists(manifest):
        sys.exit('no _mutants/manifest.json — run: node interop/falsify-app.mjs')
    known = {m['id']: m for m in json.load(open(manifest, encoding='utf-8'))}
    unknown = [a for a in args if a not in known]
    if unknown:
        sys.exit('no mutant named ' + ', '.join(unknown))
    not_killed = []
    for mid in (args or list(known)):
        m = known[mid]
        tmp = tempfile.mkdtemp(prefix='bylmut_')
        try:
            os.makedirs(os.path.join(tmp, 'interop'))
            shutil.copy(os.path.join(OUT, m['file']), os.path.join(tmp, 'byline.html'))
            shutil.copy(os.path.join(ROOT, 'byline-sw.js'), tmp)
            for f in ('run-suite.py', 'csp-hash.py'):
                shutil.copy(os.path.join(HERE, f), os.path.join(tmp, 'interop', f))
            subprocess.run([sys.executable, os.path.join(tmp, 'interop', 'csp-hash.py')],
                           check=True, capture_output=True)
            r = subprocess.run([sys.executable, os.path.join(tmp, 'interop', 'run-suite.py'),
                                engine, '--only', m['group']], capture_output=True, text=True)
            lines = r.stdout.strip().splitlines()
            failed = [l for l in lines if l.strip().startswith('FAIL ')]
            ran = not any('NOT RUN' in l for l in lines)
            verdict = 'KILLED' if (ran and failed) else 'SURVIVED' if (ran and r.returncode == 0) else 'NOT JUDGED'
            print(f'{verdict:<10} {mid}  [{m["group"]}] — {m["what"]}', flush=True)
            for l in (failed if verdict == 'KILLED' else lines):
                print('           ' + l.strip()[:240], flush=True)
            if verdict != 'KILLED':
                not_killed.append(mid)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
    print('\n' + (f'{len(not_killed)} not killed: ' + ', '.join(not_killed) if not_killed
                  else f'{len(args or known)} mutants, 0 survivors'), flush=True)
    sys.exit(min(len(not_killed), 125))


if __name__ == '__main__':
    main()
