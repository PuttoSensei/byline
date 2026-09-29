// Put the exact byline.html (and its service worker) where the shell serves it
// from. Nothing is built, bundled or rewritten: the desktop app ships the same
// bytes as the repository and the hosted site, and this refuses to stage a
// file whose Content-Security-Policy hash no longer matches its script — the
// failure that looks, from outside, exactly like a hang.
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const repo = path.resolve(here, '..', '..');
const dist = path.resolve(here, '..', 'dist');
const files = ['byline.html', 'byline-sw.js'];

const html = readFileSync(path.join(repo, 'byline.html'));
const text = html.toString('utf8');
if (text.includes('\r\n')) throw new Error('byline.html has CRLF line endings; its CSP hash cannot hold');
const scripts = [...text.matchAll(/<script>([\s\S]*?)<\/script>/g)];
if (scripts.length !== 1) throw new Error('byline.html must carry exactly one inline script, found ' + scripts.length);
const actual = createHash('sha256').update(scripts[0][1], 'utf8').digest('base64');
const declared = (/script-src 'sha256-([^']+)'/.exec(text) || [])[1];
if (declared !== actual) throw new Error(`byline.html's CSP hash is stale (declares ${declared}, script is ${actual}); run python interop/csp-hash.py`);

mkdirSync(dist, { recursive: true });
for (const f of files) copyFileSync(path.join(repo, f), path.join(dist, f));
const same = createHash('sha256').update(readFileSync(path.join(dist, 'byline.html'))).digest('hex')
  === createHash('sha256').update(html).digest('hex');
if (!same) throw new Error('the staged byline.html differs from the repository copy');
console.log(`staged ${files.join(', ')} into ${path.relative(repo, dist)} (byte-identical, CSP hash current: sha256-${actual.slice(0, 12)}…)`);
