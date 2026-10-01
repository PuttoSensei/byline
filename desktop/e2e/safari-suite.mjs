/* The in-page suite in Safari, over WebDriver. macOS only.

   The Mac desktop window is WKWebView: Safari's engine. There is no WebDriver
   for a WKWebView inside an app, so this runs the same byline.html in Safari
   itself, served over http, and reads the suite's own verdict.

     sudo safaridriver --enable     (once per machine)
     node desktop/e2e/safari-suite.mjs                                         */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname);
const repo = path.resolve(here, '..', '..');
const html = readFileSync(path.join(repo, 'byline.html'));
const sw = readFileSync(path.join(repo, 'byline-sw.js'));
const declared = (html.toString('utf8').match(/\bawait t\('/g) || []).length;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const server = createServer((req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  if (p === '/byline.html') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(html); }
  else if (p === '/byline-sw.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(sw); }
  else { res.writeHead(404); res.end(); }
}).listen(0, '127.0.0.1');
await new Promise(r => server.once('listening', r));
const site = `http://127.0.0.1:${server.address().port}/byline.html?test=1`;

const port = 4445;
const driver = spawn('safaridriver', ['--port', String(port)], { stdio: 'inherit' });
const base = `http://127.0.0.1:${port}`;
const wd = async (method, p, body) => {
  const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method} ${p}: ${r.status} ${JSON.stringify(j.value || j).slice(0, 300)}`);
  return j.value;
};
let code = 1;
try {
  for (let t0 = Date.now(); ; await sleep(250)) {
    try { await fetch(base + '/status'); break; } catch { if (Date.now() - t0 > 20_000) throw new Error('safaridriver did not start'); }
  }
  const s = await wd('POST', '/session', { capabilities: { alwaysMatch: { browserName: 'safari' } } });
  const sid = s.sessionId;
  const version = s.capabilities && s.capabilities.browserVersion;
  await wd('POST', `/session/${sid}/url`, { url: site });
  let v = null;
  for (const t0 = Date.now(); Date.now() - t0 < 600_000; await sleep(1000)) {
    v = await wd('POST', `/session/${sid}/execute/sync`, { script: `
      const t = document.body ? document.body.innerText : '';
      const n = re => +((re.exec(t) || [])[1] || 0);
      return { done: /Done\\./.test(t), passing: n(/(\\d+) passing/), failing: n(/(\\d+) failing/),
        failed: [...document.querySelectorAll('#testReport .rowbox')]
          .filter(r => r.firstElementChild && r.firstElementChild.textContent.trim() === '✕')
          .map(r => r.querySelector('.sp').textContent.replace(/\\s+/g, ' ').trim().slice(0, 300)) };`, args: [] }).catch(() => null);
    if (v && v.done) break;
  }
  await wd('DELETE', `/session/${sid}`).catch(() => {});
  if (!v || !v.done) throw new Error('the suite never finished in Safari');
  console.log(`Safari ${version}: ${v.passing} of ${declared} passing, ${v.failing} failing`);
  for (const f of v.failed) console.log('  ✕ ' + f);
  code = v.failing === 0 && v.passing === declared ? 0 : 1;
} catch (e) {
  console.log('✕ ' + (e && e.stack || e));
} finally {
  driver.kill(); server.close();
}
process.exit(code);
