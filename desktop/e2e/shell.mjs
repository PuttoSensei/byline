/* The desktop shell, tested by driving the real built app.

   Launches byline-desktop.exe with a throwaway WebView2 profile and a
   DevTools port, attaches over CDP (the way Quire's and Cardfile's e2e do on
   this machine), and checks each thing the shell claims:

     1. Byline runs from the app's own origin, not as a file:// page.
     2. The page it serves is byte-identical to the repository's byline.html.
     3. That file's own hash-only security policy is intact and nothing
        violates it; Tauri did not rewrite it.
     4. The page is given no Tauri API.
     5. Storage persists across a restart of the app, and another profile
        does not see it.
     6. The whole smoke suite passes inside the real desktop window.

     npm run build && npm run test:e2e                                       */
import { chromium } from 'playwright-core';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const desktop = path.resolve(here, '..');
const repo = path.resolve(desktop, '..');
const exe = process.env.BYLINE_EXE || path.join(desktop, 'src-tauri', 'target', 'release', 'byline-desktop.exe');
const repoHtml = readFileSync(path.join(repo, 'byline.html'));
const repoSha = createHash('sha256').update(repoHtml).digest('hex');
const declaredTests = (repoHtml.toString('utf8').match(/\bawait t\('/g) || []).length;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✕ ' + m); } };

function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer(); s.once('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}
const answers = async port => { try { await fetch(`http://127.0.0.1:${port}/json/version`); return true; } catch { return false; } };

async function launch(profile) {
  const port = await freePort();
  if (await answers(port)) throw new Error(`port ${port} already serves DevTools for another app`);
  const child = spawn(exe, [], { stdio: 'ignore', env: { ...process.env,
    WEBVIEW2_USER_DATA_FOLDER: profile,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` } });
  const until = Date.now() + 30_000;
  while (!(await answers(port))) {
    if (child.exitCode !== null) throw new Error('byline-desktop exited early with code ' + child.exitCode);
    if (Date.now() > until) throw new Error('the WebView2 debugging port never opened');
    await new Promise(r => setTimeout(r, 250));
  }
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  let page = null;
  for (const t0 = Date.now(); !page && Date.now() - t0 < 20_000;) {
    for (const ctx of browser.contexts()) for (const p of ctx.pages())
      if (/byline\.html/.test(p.url()) && /Byline/.test(await p.title().catch(() => ''))) page = p;
    if (!page) await new Promise(r => setTimeout(r, 250));
  }
  if (!page) throw new Error('no Byline page appeared in the app');
  return {
    page,
    async close() {
      await browser.close().catch(() => {});
      if (child.exitCode === null) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      await new Promise(r => setTimeout(r, 600));
    },
  };
}

if (process.platform !== 'win32') { console.log('This test attaches to WebView2 and runs on Windows only.'); process.exit(2); }
if (!existsSync(exe)) { console.log('Build the app first (npm run build): ' + exe + ' is missing'); process.exit(2); }

const tmp = mkdtempSync(path.join(os.tmpdir(), 'byline-desktop-e2e-'));
const profileA = path.join(tmp, 'a'), profileB = path.join(tmp, 'b');
const probe = 'probe-' + randomBytes(6).toString('hex');
try {
  console.log('where it runs');
  let app = await launch(profileA);
  let { page } = app;
  const violations = [];
  page.on('console', m => { if (/Content Security Policy|Refused to (execute|load|apply)/i.test(m.text())) violations.push(m.text().slice(0, 160)); });
  await page.reload();
  await page.waitForFunction(() => typeof render === 'function', null, { timeout: 15_000 });
  const where = await page.evaluate(() => ({ protocol: location.protocol, origin: location.origin }));
  ok(where.protocol !== 'file:', `Byline runs from the app's own origin (${where.origin}), not as a file:// page`);

  const served = await page.evaluate(async () => {
    const buf = await (await fetch(location.pathname, { cache: 'no-store' })).arrayBuffer();
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256', buf))].map(b => b.toString(16).padStart(2, '0')).join('');
  });
  ok(served === repoSha, 'the page it serves is byte-identical to the repository\'s byline.html');

  console.log('what protects it');
  const csp = await page.evaluate(() => {
    const m = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
    return { count: document.querySelectorAll('meta[http-equiv="Content-Security-Policy"]').length, policy: m ? m.content : '' };
  });
  const fileHash = (/script-src 'sha256-([^']+)'/.exec(repoHtml.toString('utf8')) || [])[1];
  ok(csp.count === 1 && csp.policy.includes(`'sha256-${fileHash}'`), 'its own hash-only security policy is the one in force, unrewritten');
  ok(violations.length === 0, 'and nothing on load violated it' + (violations.length ? ': ' + violations[0] : ''));
  const enforced = await page.evaluate(() => new Promise(resolve => {
    let seen = false;
    document.addEventListener('securitypolicyviolation', () => { seen = true; }, { once: true });
    const s = document.createElement('script');
    s.textContent = 'window.__bylineInjected = true';
    document.head.appendChild(s);
    setTimeout(() => { s.remove(); resolve({ seen, ran: window.__bylineInjected === true }); }, 500);
  }));
  ok(enforced.seen && !enforced.ran, 'and it is enforced: an injected inline script is blocked and reported');
  const api = await page.evaluate(async () => {
    const internals = typeof window.__TAURI_INTERNALS__ !== 'undefined';
    let invoked = 'no IPC object';
    if (internals) { try {
      await Promise.race([window.__TAURI_INTERNALS__.invoke('plugin:app|version'),
        new Promise((_, no) => setTimeout(() => no(new Error('no answer in 5s')), 5000))]);
      invoked = 'ALLOWED';
    } catch (e) { invoked = 'refused: ' + String(e).slice(0, 80); } }
    return { global: typeof window.__TAURI__ !== 'undefined', invoked };
  });
  ok(!api.global, 'the page is given no Tauri API object');
  ok(api.invoked !== 'ALLOWED', 'and a call into the shell is refused (' + api.invoked + ')');
  const storage = await page.evaluate(() => ({ shared: storageShared(location.protocol), banner: lockBanner(location.protocol) }));
  ok(!storage.shared && storage.banner === '', 'Byline itself sees storage that is not shared with other files, so no warning banner');

  console.log('what it keeps');
  await page.evaluate(p => localStorage.setItem('byline.shell.probe', p), probe);

  console.log('the whole smoke suite, inside the desktop window');
  await page.goto(new URL('byline.html?test=1', page.url()).href);
  await page.waitForFunction(() => /Done\./.test(document.body.innerText), null, { timeout: 300_000 });
  const verdict = await page.evaluate(() => {
    const t = document.body.innerText;
    const n = re => +((re.exec(t) || [])[1] || 0);
    return { passing: n(/(\d+) passing/), failing: n(/(\d+) failing/) };
  });
  ok(verdict.failing === 0 && verdict.passing === declaredTests,
    `${verdict.passing} of ${declaredTests} tests pass in the desktop window, ${verdict.failing} fail`);
  if (verdict.failing) await page.screenshot({ path: path.join(desktop, '.e2e', 'suite-failed.png'), fullPage: true }).catch(() => {});
  await app.close();

  app = await launch(profileA);
  const kept = await app.page.evaluate(() => localStorage.getItem('byline.shell.probe'));
  ok(kept === probe, 'what it stored is still there after the app is closed and started again');
  await app.close();

  app = await launch(profileB);
  const seen = await app.page.evaluate(() => localStorage.getItem('byline.shell.probe'));
  ok(seen === null, 'and a different profile does not see it');
  await app.close();
} catch (e) {
  fail++; console.log('  ✕ ' + (e && e.stack || e));
} finally {
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* WebView2 may still hold it; temp is cleared by the OS */ }
}
console.log(`\n${pass} pass, ${fail} fail`);
process.exitCode = fail ? 1 : 0;
