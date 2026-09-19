"""Keep the numbers in the prose true to the numbers in the code.

The test count and the external-check counts appear in README.md, the landing
page and interop/README.md. They were hand-edited every round and one of them
was wrong for two rounds. This reads the real counts and rewrites the prose.

    python interop/counts.py           report the counts and any drift
    python interop/counts.py --fix     rewrite the prose to match
"""
import os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INTEROP = os.path.join(ROOT, 'interop')
HARNESSES = ['verify.mjs', 'verify-formats.mjs', 'verify-oid4vp.mjs', 'verify-wallet.mjs',
             'verify-sdjwt.mjs', 'verify-rdfc.mjs', 'verify-oid4vci.mjs', 'verify-nipoa.py']
def spell(n):
    """The prose is written in words, not digits, and a --fix that wrote "95"
       into a sentence reading "Ninety-five such checks" was a regression the
       first run caught."""
    ones = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
            'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
            'seventeen', 'eighteen', 'nineteen']
    tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']
    if n < 20:
        return ones[n]
    if n < 100:
        return tens[n // 10] + ('-' + ones[n % 10] if n % 10 else '')
    # the prose says "a hundred and fifty-one", never "one hundred and fifty-one"
    lead = 'a' if n // 100 == 1 else ones[n // 100]
    return lead + ' hundred' + (' and ' + spell(n % 100) if n % 100 else '')


WORDS = {130: 'a hundred and thirty', 131: 'a hundred and thirty-one', 132: 'a hundred and thirty-two',
         133: 'a hundred and thirty-three', 134: 'a hundred and thirty-four', 135: 'a hundred and thirty-five',
         136: 'a hundred and thirty-six', 137: 'a hundred and thirty-seven', 138: 'a hundred and thirty-eight',
         139: 'a hundred and thirty-nine', 140: 'a hundred and forty', 141: 'a hundred and forty-one',
         142: 'a hundred and forty-two', 143: 'a hundred and forty-three', 144: 'a hundred and forty-four',
         145: 'a hundred and forty-five', 146: 'a hundred and forty-six', 147: 'a hundred and forty-seven',
         148: 'a hundred and forty-eight', 149: 'a hundred and forty-nine', 150: 'a hundred and fifty'}


def tests():
    s = open(os.path.join(ROOT, 'byline.html'), 'rb').read().decode('utf-8')
    return len(re.findall(r"\bawait t\('", s))


def external(run):
    """PASS lines per harness. Without --fix this is read from the last run's
       cache, because running all seven takes a minute."""
    total, per = 0, {}
    for h in HARNESSES:
        p = os.path.join(INTEROP, h)
        if not os.path.exists(p):
            continue
        if run:
            r = subprocess.run([sys.executable if p.endswith('.py') else 'node', p], capture_output=True, text=True, cwd=INTEROP)
            c = len(re.findall(r'^\s+PASS', r.stdout, re.M))
        else:
            c = None
        per[h] = c
        total += c or 0
    return total, per


def patch(path, pairs, fix):
    raw = open(path, 'rb').read().decode('utf-8')
    crlf = '\r\n' in raw
    s = raw.replace('\r\n', '\n') if crlf else raw
    drift = []
    for pat, new in pairs:
        m = re.search(pat, s)
        if not m:
            drift.append(f'{os.path.basename(path)}: no match for {pat}')
            continue
        if m.group(0) != new:
            drift.append(f'{os.path.basename(path)}: "{m.group(0)}" should be "{new}"')
            if fix:
                s = s[:m.start()] + new + s[m.end():]
    if fix and drift:
        open(path, 'wb').write((s.replace('\n', '\r\n') if crlf else s).encode('utf-8'))
    return drift


def main():
    fix = '--fix' in sys.argv
    t = tests()
    ext, per = external(fix or '--run' in sys.argv)
    print(f'tests in byline.html: {t}')
    if per and list(per.values())[0] is not None:
        for h, c in per.items():
            print(f'  {h:22} {c}')
        print(f'  external total        {ext}')
    word = WORDS.get(t, spell(t))
    drift = []
    drift += patch(os.path.join(ROOT, 'README.md'), [(r'\d+ of them, in-browser', f'{t} of them, in-browser'),
                                                    (r'Run its \d+ tests in your own browser', f'Run its {t} tests in your own browser')], fix)
    drift += patch(os.path.join(ROOT, 'byline-landing.html'),
                   [(r'A hundred and [a-z-]+ smoke tests', 'A' + word[1:] + ' smoke tests')], fix)
    if ext:
        ew = spell(ext)
        drift += patch(os.path.join(ROOT, 'byline-landing.html'),
                       [(r'[A-Z][a-z]+(?:(?:[ -]| and )[a-z]+)* such checks run outside the browser',
                         ew[0].upper() + ew[1:] + ' such checks run outside the browser')], fix)
    for d in drift:
        print(('fixed: ' if fix else 'DRIFT: ') + d)
    if not drift:
        print('prose matches the code')
    return 0 if (fix or not drift) else 1


if __name__ == '__main__':
    sys.exit(main())
