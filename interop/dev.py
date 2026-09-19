"""The edit loop for byline.html, in one command.

Every edit to the single file needs the same four things afterwards, in the
same order, or the application refuses to run: the patch applied by exact
match, the Content-Security-Policy hash re-stamped, the inline script pulled
out, and that script parsed. Doing them by hand cost four or five tool calls
per edit and the hash was forgotten twice.

    python interop/dev.py apply <patch.py>   patch, stamp, extract, node --check
    python interop/dev.py check              stamp, extract, node --check (no patch)
    python interop/dev.py find <regex>       line numbers and text, for anchors
    python interop/dev.py show <a> [<b>]     lines a..b of byline.html
    python interop/dev.py count              how many tests the suite declares

A patch script is plain Python that imports nothing from here: it opens the
file, replaces exact strings with `assert count == 1`, and writes back as
bytes with LF endings. `apply` runs it, then does the rest — and refuses to
go on if the patch left CRLF or a raw NUL in the file, both of which have
silently broken the hash before.
"""
import os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = os.path.join(ROOT, 'byline.html')
BLOCK = os.path.join(ROOT, '_blk0.js')
PY = sys.executable


def read():
    return open(APP, 'rb').read()


def guard(raw):
    """Two corruptions that produce a hash mismatch rather than an error."""
    if b'\r\n' in raw:
        sys.exit('REFUSED: the file now has CRLF line endings — write patches with open(P, "wb") and LF')
    if b'\x00' in raw:
        n = raw.count(b'\x00')
        sys.exit(f'REFUSED: {n} raw NUL byte(s) in the file — the HTML parser rewrites them to U+FFFD and the CSP hash will not match. Write them as \\u0000 in the JavaScript source.')


def extract(raw):
    s = raw.decode('utf-8')
    m = re.findall(r'<script>(.*?)</script>', s, re.S)
    if len(m) != 1:
        sys.exit(f'REFUSED: expected exactly one inline <script>, found {len(m)}')
    return m[0]


def stamp_and_check():
    raw = read()
    guard(raw)
    r = subprocess.run([PY, os.path.join(ROOT, 'interop', 'csp-hash.py')], capture_output=True, text=True)
    sys.stdout.write(r.stdout)
    if r.returncode:
        sys.stdout.write(r.stderr)
        sys.exit('REFUSED: the CSP hash could not be stamped')
    open(BLOCK, 'wb').write(extract(read()).encode('utf-8'))
    r = subprocess.run(['node', '--check', BLOCK], capture_output=True, text=True)
    if r.returncode:
        sys.stdout.write(r.stdout + r.stderr)
        sys.exit('REFUSED: the script does not parse')
    size = os.path.getsize(APP)
    print(f'syntax ok — {size:,} bytes, {test_count()} tests declared')


def test_count():
    s = read().decode('utf-8')
    return len(re.findall(r"\bawait t\('", s))


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    cmd = sys.argv[1]
    if cmd == 'apply':
        if len(sys.argv) < 3:
            sys.exit('apply needs a patch script')
        patch = sys.argv[2]
        before = read()
        r = subprocess.run([PY, patch], capture_output=True, text=True, cwd=ROOT)
        sys.stdout.write(r.stdout)
        if r.returncode:
            sys.stdout.write(r.stderr)
            sys.exit('REFUSED: the patch did not apply — the file is unchanged if the script asserts before writing')
        if read() == before:
            print('warning: the patch ran but the file is unchanged')
        stamp_and_check()
    elif cmd == 'check':
        stamp_and_check()
    elif cmd == 'find':
        pat = re.compile(sys.argv[2])
        s = read().decode('utf-8')
        for i, line in enumerate(s.split('\n'), 1):
            if pat.search(line):
                print(f'{i}: {line[:220]}')
    elif cmd == 'show':
        a = int(sys.argv[2])
        b = int(sys.argv[3]) if len(sys.argv) > 3 else a + 20
        lines = read().decode('utf-8').split('\n')
        for i in range(max(1, a), min(len(lines), b) + 1):
            print(f'{i}: {lines[i - 1]}')
    elif cmd == 'count':
        print(test_count())
    else:
        sys.exit(__doc__)


if __name__ == '__main__':
    main()
