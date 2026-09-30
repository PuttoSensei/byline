// Sign one Windows binary with Authenticode. Tauri calls this for every file it
// signs while bundling: the app, the installer and its uninstaller
// (bundle.windows.signCommand).
//
// Where the key comes from, first match wins:
//   BYLINE_SIGN_THUMBPRINT   a certificate in the Windows store: a CA-issued
//                            one, or one on a hardware token
//   BYLINE_SIGN_PFX          a certificate file, with BYLINE_SIGN_PFX_PASSWORD
// BYLINE_SIGN_TIMESTAMP      an RFC 3161 timestamp server. A release needs one,
//                            or the signature dies when the certificate expires.
//
// With none of them set it refuses, because an installer that quietly came out
// unsigned is the mistake this exists to prevent. BYLINE_UNSIGNED=1 builds an
// unsigned one on purpose, and says so.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

const file = process.argv[2];
if (!file || !existsSync(file)) { console.error(`sign: no such file: ${file}`); process.exit(1); }
const env = process.env;

if (!env.BYLINE_SIGN_THUMBPRINT && !env.BYLINE_SIGN_PFX) {
  if (env.BYLINE_UNSIGNED === '1') { console.log(`sign: LEFT UNSIGNED on request: ${path.basename(file)}`); process.exit(0); }
  console.error('sign: no certificate. Set BYLINE_SIGN_THUMBPRINT or BYLINE_SIGN_PFX (see desktop/README.md), or BYLINE_UNSIGNED=1 to build unsigned on purpose.');
  process.exit(1);
}

function signtool() {
  if (env.BYLINE_SIGNTOOL) return env.BYLINE_SIGNTOOL;
  const kits = 'C:\\Program Files (x86)\\Windows Kits\\10\\bin';
  const versions = existsSync(kits) ? readdirSync(kits).filter(v => /^10\./.test(v)) : [];
  versions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  for (const v of versions) {
    const p = path.join(kits, v, 'x64', 'signtool.exe');
    if (existsSync(p)) return p;
  }
  console.error('sign: signtool.exe not found; install the Windows SDK or set BYLINE_SIGNTOOL');
  process.exit(1);
}

const key = env.BYLINE_SIGN_THUMBPRINT
  ? ['/sha1', env.BYLINE_SIGN_THUMBPRINT]
  : ['/f', env.BYLINE_SIGN_PFX, ...(env.BYLINE_SIGN_PFX_PASSWORD ? ['/p', env.BYLINE_SIGN_PFX_PASSWORD] : [])];
const stamp = env.BYLINE_SIGN_TIMESTAMP ? ['/tr', env.BYLINE_SIGN_TIMESTAMP, '/td', 'sha256'] : [];
const r = spawnSync(signtool(), ['sign', '/fd', 'sha256', ...key, ...stamp, '/d', 'Byline', file], { encoding: 'utf8' });
// signtool echoes its arguments on some errors; never let the password reach a log.
const scrub = s => (env.BYLINE_SIGN_PFX_PASSWORD ? String(s || '').split(env.BYLINE_SIGN_PFX_PASSWORD).join('***') : String(s || ''));
if (r.status !== 0) { console.error(`sign: signtool failed on ${path.basename(file)}\n${scrub(r.stdout)}${scrub(r.stderr)}`); process.exit(1); }
console.log(`sign: signed ${path.basename(file)}${stamp.length ? ' (timestamped)' : ' (NOT timestamped)'}`);
