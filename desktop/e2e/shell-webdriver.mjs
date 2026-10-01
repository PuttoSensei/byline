/* The desktop shell on Linux, tested by driving the real built app.

   WebKitGTK has no DevTools protocol, so this speaks WebDriver to
   tauri-driver, which starts the app under WebKitWebDriver. The checks are
   the ones e2e/shell.mjs makes on Windows:

     1. Byline runs from the app's own origin, not as a file:// page, and the
        page it serves is byte-identical to the repository's byline.html.
     2. The page's own hash-only policy is in force (its script ran) and
        enforced (an injected inline script is blocked).
     3. The page is given no Tauri API, and a call into the shell is refused.
     4. The whole smoke suite passes inside the real window.
     5. Storage persists across a restart, and another profile does not see it.

   Runs inside desktop/linux's container, under a virtual display:
     xvfb-run -a node e2e/shell-webdriver.mjs <path to the app binary>          */
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname);
const repo = path.resolve(here, '..', '..');
const exe = process.argv[2];
const repoHtml = readFileSync(path.join(repo, 'byline.html'));
const repoSha = createHash('sha256').update(repoHtml).digest('hex');
const declaredTests = (repoHtml.toString('utf8').match(/\bawait t\('/g) || []).length;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✕ ' + m); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer(); s.once('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

async function launch(home) {
  const port = await freePort(), native = await freePort();
  const env = { ...process.env, HOME: home, XDG_DATA_HOME: path.join(home, 'data'), XDG_CACHE_HOME: path.join(home, 'cache'), XDG_CONFIG_HOME: path.join(home, 'config') };
  const driver = spawn('tauri-driver', ['--port', String(port), '--native-port', String(native)], { env, stdio: ['ignore', 'ignore', 'pipe'], detached: true });
  let driverErr = ''; driver.stderr.on('data', d => { driverErr += d; });
  const base = `http://127.0.0.1:${port}`;
  const wd = async (method, p, body) => {
    const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`${method} ${p}: ${r.status} ${JSON.stringify(j.value || j).slice(0, 300)}`);
    return j.value;
  };
  for (let t0 = Date.now(); ; await sleep(200)) {
    try { await fetch(base + '/status'); break; } catch { /* not up yet */ }
    if (driver.exitCode !== null || Date.now() - t0 > 20_000) throw new Error('tauri-driver did not start: ' + driverErr.slice(-500));
  }
  const s = await wd('POST', '/session', { capabilities: { alwaysMatch: { 'tauri:options': { application: exe } } } });
  const sid = s.sessionId;
  await wd('POST', `/session/${sid}/timeouts`, { script: 120_000, pageLoad: 60_000 });
  const run = (fn, ...args) => wd('POST', `/session/${sid}/execute/sync`, { script: `return (${fn}).apply(null, arguments)`, args });
  const runAsync = (fn, ...args) => wd('POST', `/session/${sid}/execute/async`, {
    script: `const done = arguments[arguments.length - 1]; Promise.resolve((${fn}).apply(null, Array.prototype.slice.call(arguments, 0, -1))).then(v => done({ v }), e => done({ e: String(e) }));`, args,
  }).then(r => { if (r && 'e' in r) throw new Error(r.e); return r && r.v; });
  const until = async (fn, ms, what) => {
    for (const t0 = Date.now(); Date.now() - t0 < ms; await sleep(500)) { try { if (await run(fn)) return; } catch { /* navigating */ } }
    throw new Error('timed out waiting for ' + what);
  };
  await until(() => typeof render === 'function', 30_000, 'Byline to start');
  return {
    run, runAsync, until,
    goto: url => wd('POST', `/session/${sid}/url`, { url }),
    async close() {
      await wd('DELETE', `/session/${sid}`).catch(() => {});
      // tauri-driver starts WebKitWebDriver, which starts the app (and an
      // AppImage starts it through AppRun). Killing tauri-driver alone left
      // that tree alive, holding the pipe this process reads, and Node never
      // exited: CI sat for 54 minutes after every check had passed. So it runs
      // in its own process group, and the whole group goes.
      try { process.kill(-driver.pid, 'SIGKILL'); } catch { /* already gone */ }
      driver.stderr.destroy(); await sleep(800);
    },
  };
}

if (!exe || !existsSync(exe)) { console.log('usage: node e2e/shell-webdriver.mjs <app binary>'); process.exit(2); }

const tmp = mkdtempSync(path.join(os.tmpdir(), 'byline-desktop-e2e-'));
const homeA = path.join(tmp, 'a'), homeB = path.join(tmp, 'b');
const probe = 'probe-' + randomBytes(6).toString('hex');
try {
  console.log('where it runs');
  let app = await launch(homeA);
  const where = await app.run(() => ({ protocol: location.protocol, origin: location.origin, href: location.href, secure: window.isSecureContext, subtle: !!(window.crypto && crypto.subtle) }));
  ok(where.protocol !== 'file:', `Byline runs from the app's own origin (${where.origin}), not as a file:// page`);
  ok(where.secure && where.subtle, `and it is a secure context with WebCrypto (secure ${where.secure}, subtle ${where.subtle})`);
  const served = await app.runAsync(async () => {
    const buf = await (await fetch(location.pathname, { cache: 'no-store' })).arrayBuffer();
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256', buf))].map(b => b.toString(16).padStart(2, '0')).join('');
  }).catch(e => 'error: ' + e.message);
  ok(served === repoSha, 'the page it serves is byte-identical to the repository\'s byline.html' + (served === repoSha ? '' : ` (${served.slice(0, 80)})`));

  console.log('what protects it');
  const csp = await app.run(() => {
    const m = document.querySelectorAll('meta[http-equiv="Content-Security-Policy"]');
    return { count: m.length, policy: m[0] ? m[0].content : '' };
  });
  const fileHash = (/script-src 'sha256-([^']+)'/.exec(repoHtml.toString('utf8')) || [])[1];
  ok(csp.count === 1 && csp.policy.includes(`'sha256-${fileHash}'`), 'its own hash-only security policy is the one in force, unrewritten (and its script ran)');
  const enforced = await app.runAsync(() => new Promise(resolve => {
    let seen = false;
    document.addEventListener('securitypolicyviolation', () => { seen = true; }, { once: true });
    const s = document.createElement('script');
    s.textContent = 'window.__bylineInjected = true';
    document.head.appendChild(s);
    setTimeout(() => { s.remove(); resolve({ seen, ran: window.__bylineInjected === true }); }, 500);
  }));
  ok(enforced.seen && !enforced.ran, 'and it is enforced: an injected inline script is blocked and reported');
  const api = await app.runAsync(async () => {
    const internals = typeof window.__TAURI_INTERNALS__ !== 'undefined';
    let invoked = 'no IPC object';
    if (internals) {
      try {
        await Promise.race([window.__TAURI_INTERNALS__.invoke('plugin:app|version'),
          new Promise((_, no) => setTimeout(() => no(new Error('no answer in 5s')), 5000))]);
        invoked = 'ALLOWED';
      } catch (e) { invoked = 'refused: ' + String(e).slice(0, 80); }
    }
    return { global: typeof window.__TAURI__ !== 'undefined', invoked };
  });
  ok(!api.global, 'the page is given no Tauri API object');
  ok(api.invoked !== 'ALLOWED', 'and a call into the shell is refused (' + api.invoked + ')');
  const storage = await app.run(() => ({ shared: storageShared(location.protocol), banner: lockBanner(location.protocol) }));
  ok(!storage.shared && storage.banner === '', 'Byline itself sees storage that is not shared with other files, so no warning banner');

  await app.run(p => localStorage.setItem('byline.shell.probe', p), probe);

  console.log('the whole smoke suite, inside the desktop window');
  await app.goto(new URL('byline.html?test=1', where.href).href);
  await app.until(() => /Done\./.test(document.body.innerText), 600_000, 'the suite to finish');
  const verdict = await app.run(() => {
    const t = document.body.innerText;
    const n = re => +((re.exec(t) || [])[1] || 0);
    const failed = [...document.querySelectorAll('#testReport .rowbox')]
      .filter(r => r.firstElementChild && r.firstElementChild.textContent.trim() === '✕')
      .map(r => r.querySelector('.sp').textContent.replace(/\s+/g, ' ').trim().slice(0, 240));
    return { passing: n(/(\d+) passing/), failing: n(/(\d+) failing/), failed };
  });
  ok(verdict.failing === 0 && verdict.passing === declaredTests, `${verdict.passing} of ${declaredTests} tests pass in the desktop window, ${verdict.failing} fail`);
  if (verdict.failed.length) console.log('    failing:\n      ' + verdict.failed.join('\n      '));
  await app.close();

  app = await launch(homeA);
  ok(await app.run(() => localStorage.getItem('byline.shell.probe')) === probe, 'what it stored is still there after the app is closed and started again');
  await app.close();

  app = await launch(homeB);
  ok(await app.run(() => localStorage.getItem('byline.shell.probe')) === null, 'and a different profile does not see it');
  await app.close();
} catch (e) {
  fail++; console.log('  ✕ ' + (e && e.stack || e));
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
console.log(`\n${pass} pass, ${fail} fail`);
// Exit with the verdict rather than wait for every handle to close: a test
// that has finished must never be what holds a build open.
process.exit(fail ? 1 : 0);
