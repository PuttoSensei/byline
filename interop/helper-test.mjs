/* Drives byline-helper.mjs the way a hostile page would, and the way Byline
   does. A program that launches coding agents on request is the most dangerous
   thing in this repository, so every guard in it is attacked from outside, by
   a stand-in agent that speaks the real output formats.

     node interop/helper-test.mjs                                              */
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8800 + Math.floor(Math.random() * 400);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'byline-helper-test-'));
const FAKE = path.join(HERE, 'fixtures', 'fake-agent.mjs');
const DUMP = path.join(TMP, 'dump.json');
const GOOD = 'http://127.0.0.1:8123';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✕ ' + m); } };
const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return false; } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function start(port, extra) {
  const child = spawn(process.execPath, [path.join(HERE, 'byline-helper.mjs'), String(port)], {
    env: Object.assign({}, process.env, { BYLINE_HELPER_TOKEN: 'sesame', BYLINE_HELPER_BIN_CLAUDE: FAKE, BYLINE_HELPER_BIN_CODEX: FAKE,
      BYLINE_HELPER_FIRST_MS: '1500', BYLINE_HELPER_RUN_MS: '6000', BYLINE_HELPER_OUT_MAX: String(64 * 1024), BYLINE_HELPER_RATE: '400',
      BYLINE_HELPER_STORE: path.join(TMP, 'store-' + port + '.json'), FAKE_DUMP: DUMP, BYLINE_HELPER_ORIGINS: '' }, extra || {}),
    stdio: ['ignore', 'pipe', 'ignore'] });
  return new Promise(res => { let b = ''; child.stdout.on('data', d => { b += d; if (/tools:|not installed/.test(b)) res({ child, banner: b }); }); });
}
/* http.request, not fetch: a test has to be able to lie about Origin and Host */
function call(method, p, { body, origin = GOOD, token = 'sesame', host, port = PORT, headers = {}, onLine, abortAfter } = {}) {
  return new Promise(resolve => {
    const h = Object.assign({ 'content-type': 'application/json' }, origin ? { origin } : {}, token ? { authorization: 'Bearer ' + token } : {}, host ? { host } : {}, headers);
    const req = http.request({ host: '127.0.0.1', port, path: p, method, headers: h }, res => {
      let text = ''; const lines = [];
      res.on('data', d => { text += d; let i; while ((i = text.indexOf('\n')) >= 0) { const l = text.slice(0, i); text = text.slice(i + 1); if (l.trim()) { try { const o = JSON.parse(l); lines.push(o); if (onLine) onLine(o); } catch (e) { lines.push({ raw: l }); } } } });
      res.on('end', () => { let json = null; try { json = JSON.parse(text); } catch (e) { } resolve({ status: res.statusCode, headers: res.headers, lines, json: json || (lines.length === 1 ? lines[0] : null) }); });
      res.on('error', () => resolve({ status: res.statusCode, headers: res.headers, lines, aborted: true }));
    });
    req.on('error', e => resolve({ status: 0, error: e.code || e.message, lines: [] }));
    if (abortAfter) setTimeout(() => req.destroy(), abortAfter);
    req.end(body == null ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)));
  });
}
const run = (job, opts) => call('POST', '/run', Object.assign({ body: job }, opts || {}));
const last = r => r.lines[r.lines.length - 1] || {};

const { child: helper } = await start(PORT);
try {
  console.log('where it listens');
  const lan = Object.values(os.networkInterfaces()).flat().find(i => i && i.family === 'IPv4' && !i.internal);
  if (lan) {
    const reached = await new Promise(res => { const s = net.connect({ host: lan.address, port: PORT, timeout: 1500 }, () => { s.destroy(); res(true); }); s.on('error', () => res(false)); s.on('timeout', () => { s.destroy(); res(false); }); });
    ok(!reached, 'it cannot be reached on this machine\'s network address (' + lan.address + '), only on 127.0.0.1');
  } else ok(true, 'no network interface to test against — loopback only by construction');

  console.log('who may ask');
  let r = await call('GET', '/harnesses', { token: null });
  ok(r.status === 401, 'no token is refused (' + r.status + ')');
  r = await call('GET', '/harnesses', { token: 'sesamf' });
  ok(r.status === 401, 'a wrong token of the right length is refused (' + r.status + ')');
  r = await call('GET', '/harnesses', { origin: 'https://evil.example' });
  ok(r.status === 403 && !r.headers['access-control-allow-origin'], 'a page from somewhere else is refused even with the token, and gets no CORS header (' + r.status + ')');
  r = await call('GET', '/harnesses', { origin: 'null' });
  ok(r.status === 403 && /opened from a file/.test((r.json || {}).error || ''), 'a file:// page is refused, and told why (' + r.status + ')');
  r = await call('GET', '/harnesses', { origin: null });
  ok(r.status === 403, 'a request with no origin at all is refused (' + r.status + ')');
  r = await call('GET', '/harnesses', { host: 'evil.example:' + PORT });
  ok(r.status === 403 && /127\.0\.0\.1/.test((r.json || {}).error || ''), 'a hostile name pointed at 127.0.0.1 (DNS rebinding) is refused by its Host header (' + r.status + ')');
  r = await call('OPTIONS', '/run', { token: null, headers: { 'access-control-request-method': 'POST', 'access-control-request-private-network': 'true' } });
  ok(r.status === 204 && r.headers['access-control-allow-origin'] === GOOD && r.headers['access-control-allow-private-network'] === 'true', 'an allowed page\'s preflight is answered, local-network opt-in included');
  r = await call('OPTIONS', '/run', { token: null, origin: 'https://evil.example' });
  ok(r.status === 403 && !r.headers['access-control-allow-origin'], 'a stranger\'s preflight is not (' + r.status + ')');
  r = await call('GET', '/harnesses');
  ok(r.status === 200 && r.json.harnesses['claude-code'].installed && r.json.harnesses.codex.installed, 'an allowed page with the token is told what is really installed');
  ok(!('goose' in r.json.harnesses), 'and nothing is claimed for an agent this helper has no adapter for');

  console.log('what it will run');
  r = await run({ harness: 'goose', prompt: 'hello' });
  ok(r.status === 404 && /no adapter/.test(r.json.error), 'a harness outside the table is refused (' + r.status + ')');
  r = await run({ harness: '__proto__', prompt: 'hello' });
  ok(r.status === 404, 'as is a name borrowed from Object.prototype (' + r.status + ')');
  r = await run({ harness: 'claude-code', prompt: 'hello', model: 'ok; rm -rf /' });
  ok(r.status === 400 && /not a model name/.test(r.json.error), 'a model name that is not a model name is refused (' + r.status + ')');
  r = await run({ harness: 'claude-code', prompt: '   ' });
  ok(r.status === 400, 'an empty prompt is refused (' + r.status + ')');
  r = await call('POST', '/run', { body: JSON.stringify({ harness: 'claude-code', prompt: 'x'.repeat(300 * 1024) }) });
  ok(r.status === 413 || r.status === 0, 'a body past the ceiling is refused (' + (r.status || r.error) + ')');

  console.log('how it runs it');
  const pwned = path.join(TMP, 'pwned.txt');
  const hostile = 'line one\n" & echo PWNED > "' + pwned + '" & "\n$(touch ' + pwned + ')\n`touch ' + pwned + '`\n| type nul > ' + pwned + '\n%COMSPEC% ^& --tools default --dangerously-skip-permissions';
  const events = [];
  r = await run({ harness: 'claude-code', system: 'You are Nib.', prompt: hostile, model: 'ok' }, { onLine: o => events.push(o.t) });
  ok(r.status === 200 && last(r).t === 'done', 'a run streams to a finish (' + events.join(' → ') + ')');
  ok(events[0] === 'start' && events.includes('tool') && events.includes('text'), 'with what the agent really did — a tool call — and what it said');
  ok(last(r).tokens && last(r).tokens.in === 210 && last(r).tokens.out === 16, 'and its real token count');
  const d = JSON.parse(fs.readFileSync(DUMP, 'utf8'));
  ok(d.stdin.includes(hostile) && d.stdin.includes('You are Nib.'), 'the brief and the prompt reached the agent on stdin, verbatim');
  ok(!d.argv.join('').includes('PWNED') && !d.argv.join(' ').includes('line one'), 'and nothing of them is on its command line: ' + JSON.stringify(d.argv.slice(1, 5)) + '…');
  ok(!fs.existsSync(pwned), 'so shell metacharacters in desk text ran nothing');
  ok(d.argv.includes('--tools') && d.argv[d.argv.indexOf('--tools') + 1] === '', 'its tools are switched off');
  ok(d.argv.includes('--strict-mcp-config') && d.argv.includes('--no-session-persistence'), 'it loads no MCP servers and keeps no session');
  ok(d.cwdEntries.length === 0 && /byline-run-/.test(d.cwd), 'it ran in a fresh, empty directory');
  await sleep(700);
  ok(!fs.existsSync(d.cwd), 'which is gone afterwards');
  ok(d.sawToken === false, 'and the helper\'s own token is not in the agent\'s environment');
  r = await run({ harness: 'codex', prompt: 'hello', model: 'ok' }, {});
  const cd = JSON.parse(fs.readFileSync(DUMP, 'utf8'));
  ok(last(r).t === 'done' && r.lines.some(l => l.t === 'tool' && l.name === 'shell') && r.lines.some(l => l.t === 'text'), 'Codex\'s format is read too: a shell command, then its answer');
  ok(cd.argv[cd.argv.indexOf('--sandbox') + 1] === 'read-only' && !cd.argv.some(a => /dangerously|full-auto/.test(a)), 'and Codex is always in its read-only sandbox');

  console.log('when it goes wrong');
  let t0 = Date.now();
  r = await run({ harness: 'claude-code', prompt: 'hello', model: 'stall' });
  ok(last(r).t === 'error' && /said nothing/.test(last(r).why) && Date.now() - t0 < 5000, 'an agent that starts and says nothing is stopped at the first-output deadline (' + (Date.now() - t0) + 'ms) — the real expired-sign-in case');
  ok(/\/login/.test(last(r).hint || ''), 'and the page is told the likely reason: ' + (last(r).hint || '').slice(0, 60) + '…');
  await sleep(600);
  const pids = JSON.parse(fs.readFileSync(DUMP + '.pids', 'utf8'));
  ok(!alive(pids.parent) && !alive(pids.child), 'the agent and the process it started are both dead');
  r = await run({ harness: 'codex', prompt: 'hello', model: 'codex-old' });
  ok(last(r).t === 'error' && /^The 'gpt-6-astra' model requires a newer version of Codex/.test(last(r).why) && !/[{}]/.test(last(r).why), 'Codex\'s real refusal is unwrapped from its JSON and passed on as a sentence: ' + (last(r).why || '').slice(0, 70) + '…');
  ok(/Upgrade the Codex CLI/.test(last(r).hint || ''), 'with what to do about it');
  r = await run({ harness: 'claude-code', prompt: 'hello', model: 'flood' });
  ok(last(r).t === 'error' && /produced more than/.test(last(r).why), 'an agent that floods is cut off at the ceiling');
  const both = await Promise.all([run({ harness: 'claude-code', prompt: 'a', model: 'slow' }), sleep(300).then(() => run({ harness: 'claude-code', prompt: 'b', model: 'slow' }))]);
  ok(last(both[0]).t === 'done' && both[1].status === 429, 'a second run on a busy harness is refused rather than queued (' + both[1].status + ')');
  r = await run({ harness: 'claude-code', prompt: 'hello', model: 'stall' }, { abortAfter: 500 });
  await sleep(900);
  const p2 = JSON.parse(fs.readFileSync(DUMP + '.pids', 'utf8'));
  ok(!alive(p2.parent) && !alive(p2.child), 'and a page that goes away takes its agent with it');
  r = await call('GET', '/harnesses');
  ok(r.json.harnesses['claude-code'].busy === false, 'after which the harness is free again');

  console.log('with nothing configured');
  const { child: bare, banner } = await start(PORT + 1, { BYLINE_HELPER_TOKEN: '' });
  try {
    const made = (/token: (\S+)/.exec(banner) || [])[1] || '';
    ok(made.length >= 24, 'started without a token, it makes one and prints it (' + made.length + ' characters)');
    r = await call('GET', '/harnesses', { port: PORT + 1, token: null, host: '127.0.0.1:' + (PORT + 1) });
    ok(r.status === 401, 'and is closed without it (' + r.status + ')');
    r = await call('GET', '/harnesses', { port: PORT + 1, token: made, host: '127.0.0.1:' + (PORT + 1) });
    ok(r.status === 200, 'and open with it (' + r.status + ')');
  } finally { bare.stdout.destroy(); bare.kill(); await new Promise(r2 => bare.once('exit', r2)); }
} finally {
  helper.stdout.destroy(); helper.kill(); await new Promise(r => helper.once('exit', r));
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { }
}
console.log(`\n${pass} pass, ${fail} fail`);
process.exitCode = fail ? 1 : 0;
