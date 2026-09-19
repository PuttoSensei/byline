"""Close out a round: refresh the Downloads copies and say what to publish.

Every round ends the same way and the same two things get forgotten — the
interop folder, and the memory line. This does the copying and prints the
checklist for the parts that need a tool call (artifacts, SendUserFile) with
the exact paths filled in.

    python interop/deliver.py            copy, then print the checklist
    python interop/deliver.py --dry      print what would be copied
"""
import os, shutil, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOWN = os.path.join(os.path.expanduser('~'), 'Downloads')
FILES = [('byline.html', 'byline.html'), ('byline-sw.js', 'byline-sw.js'),
         ('byline-landing.html', 'byline-landing.html'),
         ('README.md', 'byline-README.md'), ('THREAT-MODEL.md', 'byline-THREAT-MODEL.md')]
APP_URL = 'https://claude.ai/code/artifact/f2599ce9-e065-44eb-9477-25674cab33c8'
LANDING_URL = 'https://claude.ai/code/artifact/92b16ef8-bf3f-4178-88e9-99b171dacdca'

dry = '--dry' in sys.argv
copied = []
for src, dst in FILES:
    s, d = os.path.join(ROOT, src), os.path.join(DOWN, dst)
    if not os.path.exists(s):
        print(f'missing: {src}')
        continue
    if not dry:
        shutil.copy2(s, d)
    copied.append((dst, os.path.getsize(s)))

idst = os.path.join(DOWN, 'byline-interop')
if not dry:
    os.makedirs(idst, exist_ok=True)
n = 0
for f in sorted(os.listdir(os.path.join(ROOT, 'interop'))):
    p = os.path.join(ROOT, 'interop', f)
    if os.path.isfile(p) and not f.startswith('_'):
        if not dry:
            shutil.copy2(p, os.path.join(idst, f))
        n += 1

for name, size in copied:
    print(f'  {name:26} {size:>9,}')
print(f'  byline-interop/            {n} files')

print(f"""
Still to do, each one tool call:
  Artifact  file_path {os.path.join(ROOT, 'byline.html')}
            url       {APP_URL}
  Artifact  file_path {os.path.join(ROOT, 'byline-landing.html')}
            url       {LANDING_URL}
  SendUserFile  {os.path.join(DOWN, 'byline.html')}
                {os.path.join(DOWN, 'byline-README.md')}
                (plus whatever else this round changed)
  Memory    C:\\Users\\justi\\.claude\\projects\\C--Heya-Forge\\memory\\byline-state.md
            — test count, engines, anything learned that the repo does not record
""")
