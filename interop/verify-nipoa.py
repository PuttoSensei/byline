"""Byline's NIP-OA bridge, checked against libsecp256k1 (Bitcoin Core's C
library, through coincurve) — code with no author in common with the
@noble/secp256k1 that Byline vendors.

  1. Buzz's own published vector, recomputed by libsecp256k1.
  2. Tags Byline signs, verified by libsecp256k1 — and refused once altered.
  3. Tags libsecp256k1 signs, verified by Byline — and refused once altered.

Byline's side is its real code, lifted out of byline.html by nipoa-byline.mjs.
    python interop/verify-nipoa.py
"""
import hashlib, json, os, secrets, subprocess, sys, tempfile

try:
    import coincurve
except ImportError:
    print('coincurve is not installed (pip install coincurve) — libsecp256k1 is the point of this check')
    sys.exit(2)

HERE = os.path.dirname(os.path.abspath(__file__))
checks = 0


def check(cond, what):
    global checks
    if not cond:
        print('  FAIL ' + what)
        sys.exit(1)
    checks += 1
    print('  PASS ' + what)


def byline(mode, cases):
    with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False, encoding='utf-8') as f:
        json.dump(cases, f)
        path = f.name
    try:
        r = subprocess.run(['node', os.path.join(HERE, 'nipoa-byline.mjs'), mode, path],
                           capture_output=True, text=True, timeout=120)
        if r.returncode:
            print(r.stderr)
            sys.exit(1)
        return json.loads(r.stdout)
    finally:
        os.remove(path)


def xonly(sk):
    return coincurve.PrivateKey(sk).public_key_xonly.format().hex()


def h(agent, conditions):
    return hashlib.sha256(('nostr:agent-auth:' + agent + ':' + conditions).encode()).digest()


def verify(owner_hex, sig_hex, msg):
    try:
        return coincurve.PublicKeyXOnly(bytes.fromhex(owner_hex)).verify(bytes.fromhex(sig_hex), msg)
    except Exception:
        return False


# ---- 1. Buzz's vector ----------------------------------------------------------
ONE, TWO = (1).to_bytes(32, 'big'), (2).to_bytes(32, 'big')
OWNER = '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'
AGENT = 'c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5'
COND = 'kind=1&created_at<1713957000'
SIG = ('8b7df2575caf0a108374f8471722b233c53f9ff827a8b0f91861966c3b9dd5cb'
       '2e189eae9f49d72187674c2f5bd244145e10ff86c9f257ffe65a1ee5f108b369')
check(xonly(ONE) == OWNER, "libsecp256k1 derives the vector's owner key")
check(xonly(TWO) == AGENT, "and its agent key")
check(h(AGENT, COND).hex() == '08cdecd55af4c28d3801fd69615dcf5cc04fab3bc134b38a840bf157197069a6', 'and its signed hash')
check(verify(OWNER, SIG, h(AGENT, COND)), "libsecp256k1 accepts Buzz's own vector signature")
zero_aux = coincurve.PrivateKey(ONE).sign_schnorr(h(AGENT, COND), bytes(32)).hex()
same = byline('sign', [{'owner': ONE.hex(), 'agent': AGENT, 'conditions': COND, 'aux': '00' * 32}])[0]
check(same[3] == zero_aux, 'Byline and libsecp256k1 produce the identical signature from the same key, message and aux')
check(same == ['auth', OWNER, COND, same[3]], 'and the same tag')

# ---- 2. Byline signs, libsecp256k1 verifies ----------------------------------------
CONDS = ['', 'kind=9', 'created_at<1800000000', 'kind=9&created_at<1900000000&created_at>1700000000', 'kind=65535']
cases = []
for i in range(10):
    o, a = secrets.token_bytes(32), secrets.token_bytes(32)
    cases.append({'owner': o.hex(), 'agent': xonly(a), 'conditions': CONDS[i % len(CONDS)]})
tags = byline('sign', cases)
for c, t in zip(cases, tags):
    check(len(t) == 4 and t[0] == 'auth', 'a Byline tag has four elements')
    check(t[1] == xonly(bytes.fromhex(c['owner'])), 'its owner key is the one libsecp256k1 derives')
    check(t[2] == c['conditions'], 'its conditions are carried verbatim')
    check(verify(t[1], t[3], h(c['agent'], c['conditions'])), 'libsecp256k1 accepts a tag Byline signed')
    altered = c['conditions'] + ('&kind=1' if c['conditions'] else 'kind=1')
    check(not verify(t[1], t[3], h(c['agent'], altered)), 'and refuses it once its conditions are altered')
    other = xonly(secrets.token_bytes(32))
    check(not verify(t[1], t[3], h(other, c['conditions'])), 'or moved to a different agent')

# ---- 3. libsecp256k1 signs, Byline verifies ----------------------------------------
vcases, expect = [], []
for i in range(10):
    o, a = secrets.token_bytes(32), secrets.token_bytes(32)
    owner, agent = xonly(o), xonly(a)
    cond = 'kind=9&created_at<1800000000'
    sig = coincurve.PrivateKey(o).sign_schnorr(h(agent, cond), secrets.token_bytes(32)).hex()
    ev = {'pubkey': agent, 'kind': 9, 'created_at': 1750000000}
    good = ['auth', owner, cond, sig]
    vcases.append({'tag': good, 'event': ev}); expect.append((True, 'libsecp256k1 signed it', None))
    flipped = sig[:-2] + ('00' if sig[-2:] != '00' else '01')
    vcases.append({'tag': ['auth', owner, cond, flipped], 'event': ev}); expect.append((False, 'a signature altered by one byte', 'did not sign'))
    vcases.append({'tag': good, 'event': dict(ev, kind=1)}); expect.append((False, 'an event of another kind', 'covers kind'))
    vcases.append({'tag': good, 'event': dict(ev, created_at=1800000000)}); expect.append((False, 'an event at the deadline', 'expired'))
    # each rule on its own: a valid signature over exactly the defect, so only that rule can refuse it
    self_sig = coincurve.PrivateKey(a).sign_schnorr(h(agent, cond), secrets.token_bytes(32)).hex()
    vcases.append({'tag': ['auth', agent, cond, self_sig], 'event': ev}); expect.append((False, 'self-attestation, validly signed by the agent itself', 'attest itself'))
    lz = 'kind=09&created_at<1800000000'
    lz_sig = coincurve.PrivateKey(o).sign_schnorr(h(agent, lz), secrets.token_bytes(32)).hex()
    vcases.append({'tag': ['auth', owner, lz, lz_sig], 'event': ev}); expect.append((False, 'a leading zero, validly signed', 'malformed'))
    tr = 'kind=9&'
    tr_sig = coincurve.PrivateKey(o).sign_schnorr(h(agent, tr), secrets.token_bytes(32)).hex()
    vcases.append({'tag': ['auth', owner, tr, tr_sig], 'event': ev}); expect.append((False, 'a trailing delimiter, validly signed', 'malformed'))
results = byline('verify', vcases)
for r, (want, what, why) in zip(results, expect):
    check(r['ok'] is want, ('Byline accepts: ' if want else 'Byline refuses: ') + what + ('' if r['ok'] is want else ' (%s)' % r['why']))
    if why:
        check(why in (r['why'] or ''), '  … and for the right reason: ' + why + ' (it said: %s)' % r['why'])

print('verify-nipoa.py: %d checks against libsecp256k1 %s' % (checks, coincurve.__version__))
