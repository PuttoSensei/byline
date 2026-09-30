/* The installer, tested by using it.

   Builds the NSIS installer signed with a throwaway test certificate
   (scripts/test-cert.mjs), then checks:

     1. The installer, the app inside it and its uninstaller all carry a
        signature from that certificate, and a changed byte breaks it.
     2. A silent per-user install puts the same signed app on disk and needs
        no administrator.
     3. The installed app passes the whole desktop e2e (e2e/shell.mjs).
     4. Uninstalling removes the program, its shortcut and its registry
        entry, and the install never created a profile of its own.

   It refuses to run if Byline is already installed for this user, rather than
   uninstall a real copy.

     npm run test:installer            (--skip-build to reuse the last build)  */
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ensureTestCert } from '../scripts/test-cert.mjs';

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const desktop = path.resolve(here, '..');
const conf = JSON.parse(readFileSync(path.join(desktop, 'src-tauri', 'tauri.conf.json'), 'utf8'));
const setup = path.join(desktop, 'src-tauri', 'target', 'release', 'bundle', 'nsis', `${conf.productName}_${conf.version}_x64-setup.exe`);
const UNINSTALL_KEY = `HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${conf.productName}`;
const SHORTCUT = path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', `${conf.productName}.lnk`);
const DESKTOP_SHORTCUT = path.join(os.homedir(), 'Desktop', `${conf.productName}.lnk`);
const PROFILE = path.join(process.env.LOCALAPPDATA, conf.identifier);

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✕ ' + m); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ps = cmd => spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], { encoding: 'utf8' }).stdout.trim();
const keyExists = k => ps(`Test-Path '${k}'`) === 'True';
function signature(file) {
  const out = ps(`$s = Get-AuthenticodeSignature -LiteralPath '${file}'; [pscustomobject]@{ status = [string]$s.Status; thumb = [string]$s.SignerCertificate.Thumbprint; subject = [string]$s.SignerCertificate.Subject } | ConvertTo-Json -Compress`);
  try { return JSON.parse(out); } catch { return { status: 'unreadable: ' + out.slice(0, 120) }; }
}
// Signed by our certificate and intact. A self-signed certificate is not trusted
// here on purpose, so Windows reports the chain as UnknownError, never Valid.
const signedBy = (s, thumb) => s.thumb === thumb && s.status !== 'NotSigned' && s.status !== 'HashMismatch';
const run = (file, args) => new Promise(resolve => {
  const c = spawn(file, args, { stdio: 'ignore', windowsVerbatimArguments: true });
  c.on('exit', code => resolve(code)); c.on('error', () => resolve(-1));
});

if (process.platform !== 'win32') { console.log('The installer is Windows-only.'); process.exit(2); }
const already = [keyExists(UNINSTALL_KEY) && UNINSTALL_KEY, existsSync(SHORTCUT) && SHORTCUT].filter(Boolean);
if (already.length) { console.log('Byline is already installed for this user; refusing to touch it:\n  ' + already.join('\n  ')); process.exit(2); }
const profileBefore = existsSync(PROFILE);

const cert = ensureTestCert();
if (!process.argv.includes('--skip-build')) {
  console.log('building the installer, signed with the test certificate…');
  const b = spawnSync('npm run installer', { cwd: desktop, encoding: 'utf8', shell: true,
    env: { ...process.env, BYLINE_SIGN_PFX: cert.pfx, BYLINE_SIGN_PFX_PASSWORD: cert.password, BYLINE_SIGN_THUMBPRINT: '', BYLINE_UNSIGNED: '' } });
  if (b.status !== 0) { console.log((b.stdout + b.stderr).split(cert.password).join('***').slice(-3000)); process.exit(1); }
}
if (!existsSync(setup)) { console.log('no installer at ' + setup); process.exit(1); }

const tmp = mkdtempSync(path.join(os.tmpdir(), 'byline-installer-e2e-'));
const dir = path.join(tmp, 'Byline');
let installed = false;
try {
  console.log('what was built');
  const s = signature(setup);
  ok(signedBy(s, cert.thumbprint), `the installer is signed by the test certificate (${s.status}, ${s.subject || 'no signer'})`);
  const tampered = path.join(tmp, 'tampered-setup.exe');
  const bytes = readFileSync(setup);
  bytes[Math.floor(bytes.length / 2)] ^= 0x01;
  writeFileSync(tampered, bytes);
  ok(signature(tampered).status === 'HashMismatch', 'one changed byte in the installer breaks its signature');
  const unsigned = path.join(tmp, 'unsigned-probe.exe');
  copyFileSync(path.join(process.env.SystemRoot, 'System32', 'findstr.exe'), unsigned);
  ok(signature(tampered).thumb === cert.thumbprint && signature(unsigned).thumb !== cert.thumbprint, 'and the check tells our signature from someone else\'s');

  console.log('installing, silently, for this user only');
  const code = await run(setup, ['/S', `/D=${dir}`]);
  installed = true;
  ok(code === 0, `the installer exits cleanly (code ${code})`);
  const exes = existsSync(dir) ? readdirSync(dir).filter(f => /\.exe$/i.test(f) && !/^uninstall/i.test(f)) : [];
  const exe = exes.length === 1 ? path.join(dir, exes[0]) : null;
  const uninstaller = path.join(dir, 'uninstall.exe');
  ok(!!exe && existsSync(uninstaller), `it put the app (${exes.join(', ') || 'nothing'}) and an uninstaller in the chosen folder`);
  // Tauri signs the app only inside the bundle and then restores target/release's
  // copy unsigned, so the installed copy is the one that has to carry it.
  ok(!!exe && signedBy(signature(exe), cert.thumbprint), 'the installed app carries the signature');
  ok(existsSync(uninstaller) && signedBy(signature(uninstaller), cert.thumbprint), 'the uninstaller is signed too');
  ok(keyExists(UNINSTALL_KEY), 'it is listed under Installed apps (HKCU, no administrator)');
  ok(existsSync(SHORTCUT), 'and has a Start menu shortcut');
  ps(`Get-Process | Where-Object { $_.Path -like '${dir}\\*' } | Stop-Process -Force`);

  if (exe) {
    console.log('the installed app, through the whole desktop e2e');
    const e = spawnSync(process.execPath, [path.join(here, 'shell.mjs')], { encoding: 'utf8', env: { ...process.env, BYLINE_EXE: exe } });
    const lines = e.stdout.split(/\r?\n/).filter(l => /^\s+[✓✕]/.test(l));
    for (const l of lines) console.log('    ' + l.trim());
    ok(e.status === 0 && lines.length > 0, `the installed app passes it (${e.stdout.trim().split(/\r?\n/).pop()})`);
  }

  console.log('uninstalling');
  const ucode = await run(uninstaller, ['/S']);
  for (let i = 0; i < 120 && (existsSync(uninstaller) || keyExists(UNINSTALL_KEY)); i++) await sleep(500);
  installed = existsSync(uninstaller) || keyExists(UNINSTALL_KEY);
  ok(ucode === 0 && !installed, `the uninstaller exits cleanly and removes the program (code ${ucode})`);
  ok(!keyExists(UNINSTALL_KEY), 'and its Installed apps entry');
  ok(!existsSync(SHORTCUT) && !existsSync(DESKTOP_SHORTCUT), 'and its shortcuts');
  ok(existsSync(PROFILE) === profileBefore, 'installing and uninstalling never created a profile in this user\'s app data');
} catch (e) {
  fail++; console.log('  ✕ ' + (e && e.stack || e));
} finally {
  if (installed && existsSync(path.join(dir, 'uninstall.exe'))) await run(path.join(dir, 'uninstall.exe'), ['/S']);
  await sleep(1500);
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* the uninstaller may still hold it */ }
}
console.log(`\n${pass} pass, ${fail} fail`);
process.exitCode = fail ? 1 : 0;
