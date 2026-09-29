"""Break the desktop shell's config on purpose; the e2e must fail each time.

   python e2e/mutants.py      (rebuilds the app per mutant, then the real one)"""
import json, pathlib, shutil, subprocess, sys

D = pathlib.Path(__file__).resolve().parent.parent
CONF = D / 'src-tauri' / 'tauri.conf.json'
CAPS = D / 'src-tauri' / 'capabilities'
original = CONF.read_bytes()


def with_conf(edit):
    def apply():
        c = json.loads(original)
        edit(c)
        CONF.write_text(json.dumps(c, indent=2) + '\n', encoding='utf-8', newline='\n')
    return apply


def add_capability():
    CAPS.mkdir(exist_ok=True)
    (CAPS / 'default.json').write_text(json.dumps(
        {"identifier": "default", "windows": ["main"], "permissions": ["core:default"]}), encoding='utf-8')


MUTANTS = [
    ('global-tauri-api', with_conf(lambda c: c['app'].__setitem__('withGlobalTauri', True)), 'no Tauri API object'),
    ('tauri-rewrites-csp', with_conf(lambda c: c['app']['security'].__setitem__('csp', "default-src 'self'; script-src 'self'")), None),
    ('ipc-granted', add_capability, 'call into the shell is refused'),
]

if CAPS.exists():
    sys.exit(f'{CAPS} exists; this script deletes it after each mutant, so it refuses to run')

npm = shutil.which('npm') or 'npm.cmd'
survivors = []
try:
    for name, apply, expect in MUTANTS:
        apply()
        b = subprocess.run([npm, 'run', 'build'], cwd=D, capture_output=True, text=True, encoding='utf-8', errors='replace')
        if b.returncode:
            print(f'{name}: BUILD FAILED\n{b.stdout[-1500:]}{b.stderr[-1500:]}')
            survivors.append(name)
        else:
            r = subprocess.run(['node', 'e2e/shell.mjs'], cwd=D, capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=900)
            failed = [l.strip() for l in r.stdout.splitlines() if l.strip().startswith('✕')]
            hit = r.returncode != 0 and (expect is None or any(expect in l for l in failed))
            print(f'{name}: {"KILLED" if hit else "SURVIVED"}  exit={r.returncode}')
            for l in failed:
                print('   ', l[:200])
            if not hit:
                survivors.append(name)
        CONF.write_bytes(original)
        shutil.rmtree(CAPS, ignore_errors=True)
finally:
    CONF.write_bytes(original)
    shutil.rmtree(CAPS, ignore_errors=True)
    print('restored; rebuilding the real app')
    subprocess.run([npm, 'run', 'build'], cwd=D, capture_output=True)
print(f'{len(MUTANTS) - len(survivors)} of {len(MUTANTS)} killed' + (f'; survived: {survivors}' if survivors else ''))
sys.exit(1 if survivors else 0)
