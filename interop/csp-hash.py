"""Stamp the inline script's SHA-256 into byline.html's Content-Security-Policy.

    python interop/csp-hash.py            # rewrite the hash in place
    python interop/csp-hash.py --check    # exit 1 if the hash on file is stale

The page has one inline <script>. A hash-only script-src means any other
inline script — one injected through a hostile import, an extension, or a
pasted line — is refused by the browser. The hash covers the script's exact
bytes, so it has to be recomputed after every edit; a stale hash means the
whole application refuses to run, loudly, which is the right failure.
"""
import base64, hashlib, re, sys

P = __file__.replace('interop', '').rstrip('\\/') + 'byline.html' if False else None
import os
P = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'byline.html')

s = open(P, 'rb').read().decode('utf-8')
scripts = re.findall(r'<script>(.*?)</script>', s, re.S)
assert len(scripts) == 1, f'expected one inline script, found {len(scripts)}'
digest = base64.b64encode(hashlib.sha256(scripts[0].encode('utf-8')).digest()).decode()
m = re.search(r"script-src 'sha256-([A-Za-z0-9+/=]+|PENDING)'", s)
assert m, 'no script-src hash slot in the policy'
if '--check' in sys.argv:
    ok = m.group(1) == digest
    print('csp hash', 'current' if ok else 'STALE')
    sys.exit(0 if ok else 1)
if m.group(1) != digest:
    s = s[:m.start(1)] + digest + s[m.end(1):]
    open(P, 'wb').write(s.encode('utf-8'))
    print('csp hash updated:', digest)
else:
    print('csp hash unchanged:', digest)
