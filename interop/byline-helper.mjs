/* Byline's local helper: the one thing a web page cannot do for itself.

   A page cannot start a program. So the named coding harnesses in Byline —
   Claude Code, Codex — were labels, and correspondents "ran on" them only in
   a script. This is the missing piece: a small program on your own machine
   that Byline asks to run one of those agents with a prompt, and that streams
   back what the agent actually did and said.

   It is also the most dangerous file in this repository, because a program
   that launches coding agents on request is exactly what an attacker wants to
   find listening. So, in order of importance:

     1. It listens on 127.0.0.1 and nowhere else.
     2. Every request needs a bearer token. If you do not set one, it makes
        one, keeps it next to this file, and prints it.
     3. It answers only pages from origins you named (and never a file://
        page: Chrome gives every local file one shared storage area, so a
        token kept by one local page is readable by the next).
     4. It checks the Host header, so a hostile site cannot reach it by
        pointing its own name at 127.0.0.1.
     5. It runs a fixed table of programs with fixed arguments, never through
        a shell. What Byline sends — the brief, the desk's history — goes to
        the agent on stdin and nowhere near a command line.
     6. Agents run in a fresh, empty directory that is deleted afterwards,
        with their tools switched off unless you turned research on, and
        Codex always in its read-only sandbox.
     7. One run per harness at a time, a deadline for the first output, a
        deadline for the whole run, a ceiling on output, and the whole
        process tree is killed when any of them is hit or the page goes away.

   What it does not do: it cannot check a Byline credential. Authority is
   enforced where it always was, in Byline, which holds a live agent's copy
   for your release unless you told that correspondent to file directly.

     node interop/byline-helper.mjs [port]           default 8127

     BYLINE_HELPER_TOKEN=secret      your own token instead of a made one
     BYLINE_HELPER_ORIGINS=a,b       pages allowed to ask (scheme://host[:port]);
                                     default: https://puttosensei.github.io and
                                     any http://127.0.0.1 or http://localhost port
     BYLINE_HELPER_TOOLS=research    let Claude Code search and fetch the web.
                                     Off by default: an agent that reads a desk
                                     can be steered by what is written on it, and
                                     one that can fetch can be steered into
                                     carrying what it read somewhere else.
     BYLINE_HELPER_BIN_CLAUDE=path   where an agent lives, if not on PATH
     BYLINE_HELPER_BIN_CODEX=path
     BYLINE_HELPER_FIRST_MS, _RUN_MS, _OUT_MAX, _RATE, _STORE   limits; see below */

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.argv[2] || '8127', 10);
const num = (name, dflt) => { const v = parseInt(process.env[name] || '', 10); return v > 0 ? v : dflt; };
const FIRST_MS = num('BYLINE_HELPER_FIRST_MS', 60e3);   // an agent that says nothing for this long is not going to
const RUN_MS = num('BYLINE_HELPER_RUN_MS', 180e3);
const OUT_MAX = num('BYLINE_HELPER_OUT_MAX', 512 * 1024);
const RATE = num('BYLINE_HELPER_RATE', 30);             // requests a minute
const BODY_MAX = 256 * 1024;
const STORE = process.env.BYLINE_HELPER_STORE || path.join(HERE, '_helper.json');
const RESEARCH = (process.env.BYLINE_HELPER_TOOLS || '') === 'research';

/* ---------- the token ---------- */
let store = {};
try { store = JSON.parse(fs.readFileSync(STORE, 'utf8')); } catch (e) { /* first run */ }
const TOKEN_FROM_ENV = !!process.env.BYLINE_HELPER_TOKEN;
if (!TOKEN_FROM_ENV && !store.token) {
  store.token = randomBytes(24).toString('base64url');
  try { fs.writeFileSync(STORE, JSON.stringify(store, null, 1)); } catch (e) { /* still works for this run */ }
}
const TOKEN = process.env.BYLINE_HELPER_TOKEN || store.token;
const authorised = req => {
  const a = Buffer.from(String(req.headers.authorization || '')), b = Buffer.from('Bearer ' + TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
};

/* ---------- who may ask ---------- */
const NAMED = (process.env.BYLINE_HELPER_ORIGINS || 'https://puttosensei.github.io')
  .split(',').map(x => x.trim().replace(/\/+$/, '').toLowerCase()).filter(Boolean);
const LOOPBACK_PAGES = !process.env.BYLINE_HELPER_ORIGINS;
function originAllowed(origin) {
  const o = String(origin || '').toLowerCase();
  if (!o || o === 'null') return false;                   // no origin, or a file:// page
  if (NAMED.indexOf(o) >= 0) return true;
  return LOOPBACK_PAGES && /^http:\/\/(127\.0\.0\.1|localhost)(:\d{1,5})?$/.test(o);
}
const hostOk = req => ['127.0.0.1:' + PORT, 'localhost:' + PORT].indexOf(String(req.headers.host || '').toLowerCase()) >= 0;

/* ---------- finding a program without asking a shell ---------- */
function onPath(names) {
  const exts = process.platform === 'win32' ? ['.exe'] : [''];   // never .cmd or .bat: those need a shell
  for (const dir of String(process.env.PATH || '').split(path.delimiter).filter(Boolean))
    for (const n of names) for (const e of exts) {
      const p = path.join(dir, n + e);
      try { if (fs.statSync(p).isFile()) return p; } catch (err) { /* not here */ }
    }
  return null;
}
function resolveBin(envName, names) {
  const forced = process.env[envName];
  const p = forced || onPath(names);
  if (!p) return null;
  /* a .js or .mjs file is run by this same Node: how the tests stand an agent in */
  return /\.m?js$/i.test(p) ? { cmd: process.execPath, pre: [p], shown: p } : { cmd: p, pre: [], shown: p };
}

/* ---------- the harnesses: a fixed table, fixed arguments ---------- */
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const HARNESSES = {
  'claude-code': {
    name: 'Claude Code', bin: () => resolveBin('BYLINE_HELPER_BIN_CLAUDE', ['claude']),
    args: model => ['-p', '--tools', RESEARCH ? 'WebSearch,WebFetch' : '',
      ...(RESEARCH ? ['--allowedTools', 'WebSearch,WebFetch'] : []),
      '--output-format', 'stream-json', '--verbose', '--no-session-persistence',
      '--setting-sources', '', '--strict-mcp-config', ...(model ? ['--model', model] : [])],
    tools: RESEARCH ? 'web search and fetch' : 'none',
    stalled: 'Claude Code started and then said nothing. It is usually not signed in: run `claude` in a terminal, type /login, and try again.',
    read(o, emit) {
      if (o.type === 'assistant' && o.message && Array.isArray(o.message.content)) {
        for (const b of o.message.content) {
          if (b.type === 'text' && b.text) emit({ t: 'text', text: b.text });
          if (b.type === 'tool_use') emit({ t: 'tool', name: String(b.name || 'tool'), detail: brief(b.input) });
        }
      }
      if (o.type === 'result') {
        if (o.is_error) return { error: String(o.result || o.subtype || 'the run failed') };
        const u = o.usage || {};
        return { done: { in: u.input_tokens || 0, out: u.output_tokens || 0 } };
      }
      return null;
    },
  },
  'codex': {
    name: 'Codex', bin: () => resolveBin('BYLINE_HELPER_BIN_CODEX', ['codex']),
    args: model => ['exec', ...(model ? ['-m', model] : []), '--sandbox', 'read-only', '--skip-git-repo-check',
      '--ephemeral', '--json', '--color', 'never', '-'],
    tools: 'read-only sandbox',
    stalled: 'Codex started and then said nothing. Check `codex login status` in a terminal.',
    read(o, emit) {
      if (o.type === 'item.completed' && o.item) {
        const it = o.item;
        if (it.type === 'agent_message' && it.text) emit({ t: 'text', text: it.text });
        else if (it.type === 'command_execution') emit({ t: 'tool', name: 'shell', detail: brief(it.command) });
        else if (it.type && it.type !== 'reasoning') emit({ t: 'tool', name: String(it.type), detail: brief(it.query || it.path || it.text || '') });
      }
      if (o.type === 'turn.completed') { const u = o.usage || {}; return { done: { in: u.input_tokens || 0, out: u.output_tokens || 0 } }; }
      if (o.type === 'turn.failed' || o.type === 'error') {
        let why = (o.error && o.error.message) || o.message || 'the run failed';
        try { const inner = JSON.parse(why); why = (inner.error && inner.error.message) || why; } catch (e) { /* already plain */ }
        return { error: String(why) };
      }
      return null;
    },
  },
};
const brief = v => { const s = typeof v === 'string' ? v : JSON.stringify(v == null ? '' : v); return s.replace(/\s+/g, ' ').slice(0, 160); };
function hintFor(why) {
  if (/requires a newer version/i.test(why)) return 'Upgrade the Codex CLI, then try again.';
  if (/not supported when using Codex with a ChatGPT account/i.test(why)) return 'That model is not available to your Codex account. Leave the model on automatic.';
  if (/OAuth|authentication|401|log ?in|api key/i.test(why)) return 'The agent is not signed in. Run it once in a terminal and sign in.';
  return null;
}

/* ---------- killing a run, all of it ---------- */
function killTree(child) {
  if (!child || child.exitCode !== null) return;
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else { try { process.kill(-child.pid, 'SIGKILL'); } catch (e) { child.kill('SIGKILL'); } }
  } catch (e) { /* already gone */ }
}

/* ---------- plumbing ---------- */
const buckets = new Map();
function allow(ip) {
  const t = Date.now(); let b = buckets.get(ip);
  if (!b) { b = { tokens: RATE, at: t }; buckets.set(ip, b); }
  b.tokens = Math.min(RATE, b.tokens + (t - b.at) * RATE / 60e3); b.at = t;
  if (b.tokens < 1) return false;
  b.tokens -= 1; return true;
}
const cors = (req, extra) => Object.assign({ 'cache-control': 'no-store', vary: 'origin' },
  originAllowed(req.headers.origin) ? { 'access-control-allow-origin': req.headers.origin } : {}, extra || {});
function send(req, res, status, body) {
  res.writeHead(status, cors(req, { 'content-type': 'application/json' }));
  res.end(JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', c => { n += c.length; if (n > BODY_MAX) { reject(new Error('body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
const running = new Map();                                // harness id → child
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

function versionOf(bin) {
  try {
    const r = spawnSync(bin.cmd, bin.pre.concat(['--version']), { encoding: 'utf8', timeout: 8000, shell: false, windowsHide: true });
    return String(r.stdout || '').trim().split(/\r?\n/)[0].slice(0, 80) || null;
  } catch (e) { return null; }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  /* the order matters: who is asking comes before anything they ask for */
  if (!hostOk(req)) return send(req, res, 403, { error: 'this helper answers to 127.0.0.1:' + PORT + ' only' });
  if (req.method === 'OPTIONS') {
    if (!originAllowed(req.headers.origin)) { res.writeHead(403); return res.end(); }
    res.writeHead(204, cors(req, { 'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-private-network': 'true',
      'access-control-max-age': '600' }));
    return res.end();
  }
  if (!allow(req.socket.remoteAddress || '?')) return send(req, res, 429, { error: 'too many requests — wait a moment' });
  if (!originAllowed(req.headers.origin))
    return send(req, res, 403, { error: String(req.headers.origin) === 'null'
      ? 'a page opened from a file is refused: serve Byline over http or https and name that origin'
      : 'that page is not one this helper was told to answer — name it in BYLINE_HELPER_ORIGINS' });
  if (!authorised(req)) return send(req, res, 401, { error: 'this helper wants the bearer token it printed when it started' });

  try {
    if (req.method === 'GET' && url.pathname === '/harnesses') {
      const out = {};
      for (const [id, h] of Object.entries(HARNESSES)) {
        const bin = h.bin();
        out[id] = bin ? { installed: true, name: h.name, version: versionOf(bin), tools: h.tools, busy: running.has(id) }
                      : { installed: false, name: h.name };
      }
      return send(req, res, 200, { helper: 'byline-helper', harnesses: out, research: RESEARCH });
    }

    if (req.method === 'POST' && url.pathname === '/run') {
      let job; try { job = JSON.parse(await readBody(req)); } catch (e) { return send(req, res, e.message === 'body too large' ? 413 : 400, { error: e.message === 'body too large' ? 'body too large' : 'not JSON' }); }
      const id = String(job && job.harness || '');
      const h = Object.prototype.hasOwnProperty.call(HARNESSES, id) ? HARNESSES[id] : null;
      if (!h) return send(req, res, 404, { error: 'no adapter for "' + id.slice(0, 40) + '" — this helper runs: ' + Object.keys(HARNESSES).join(', ') });
      const model = job.model == null || job.model === '' ? null : String(job.model);
      if (model && !MODEL.test(model)) return send(req, res, 400, { error: 'that is not a model name' });
      const prompt = String(job.prompt || ''), system = String(job.system || '');
      if (!prompt.trim()) return send(req, res, 400, { error: 'nothing to ask' });
      const bin = h.bin();
      if (!bin) return send(req, res, 424, { error: h.name + ' is not installed on this machine' });
      if (running.has(id)) return send(req, res, 429, { error: h.name + ' is already working on something — one run at a time' });

      const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'byline-run-'));
      const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDECODE$|CLAUDE_CODE_|CLAUDE_PID$|BYLINE_HELPER_TOKEN$)/.test(k)));
      const started = Date.now();
      const child = spawn(bin.cmd, bin.pre.concat(h.args(model)), { cwd, env, shell: false, windowsHide: true,
        detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
      running.set(id, child);

      res.writeHead(200, cors(req, { 'content-type': 'application/x-ndjson', 'x-accel-buffering': 'no' }));
      let finished = false, spoke = false, outBytes = 0, buf = '', errTail = '';
      const emit = o => { if (!finished || o.t === 'done' || o.t === 'error') { try { res.write(JSON.stringify(o) + '\n'); } catch (e) { /* page went away */ } } };
      const finish = (last, outcome) => {
        if (finished) return; finished = true;
        clearTimeout(firstTimer); clearTimeout(runTimer);
        killTree(child); running.delete(id);
        emit(last); try { res.end(); } catch (e) { /* gone */ }
        setTimeout(() => { try { fs.rmSync(cwd, { recursive: true, force: true }); } catch (e) { /* in use: the OS clears temp */ } }, 300);
        log(id, outcome, (Date.now() - started) + 'ms', 'from', req.headers.origin);
      };
      const fail = (why, hint) => finish(Object.assign({ t: 'error', why: String(why).slice(0, 400) }, (hint || hintFor(why)) ? { hint: hint || hintFor(why) } : {}), 'failed: ' + String(why).slice(0, 80));
      const firstTimer = setTimeout(() => { if (!spoke) fail('it started and then said nothing for ' + Math.round(FIRST_MS / 1000) + ' seconds', h.stalled); }, FIRST_MS);
      const runTimer = setTimeout(() => fail('it ran past ' + Math.round(RUN_MS / 1000) + ' seconds and was stopped'), RUN_MS);

      emit({ t: 'start', harness: id, name: h.name, tools: h.tools });
      child.stdout.on('data', d => {
        outBytes += d.length;
        if (outBytes > OUT_MAX) return fail('it produced more than ' + Math.round(OUT_MAX / 1024) + 'KB and was stopped');
        buf += d.toString('utf8');
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
          if (line[0] !== '{') continue;                  // Windows prints taskkill chatter on stdout; not ours
          let o; try { o = JSON.parse(line); } catch (e) { continue; }
          const r = h.read(o, e => { spoke = true; emit(e); });
          if (r && r.error) return fail(r.error);
          if (r && r.done) return finish({ t: 'done', tokens: r.done, ms: Date.now() - started }, 'ok');
        }
      });
      child.stderr.on('data', d => { errTail = (errTail + d.toString('utf8')).slice(-600); });
      child.on('error', e => fail('it could not be started: ' + e.message));
      child.on('exit', code => { if (!finished) fail(code === 0 ? 'it ended without an answer' : 'it exited with code ' + code + (errTail ? ': ' + errTail.trim().split(/\r?\n/).pop().slice(0, 200) : '')); });
      res.on('close', () => { if (!finished) finish({ t: 'error', why: 'the page went away' }, 'abandoned'); });

      child.stdin.on('error', () => { /* it closed stdin early; the exit handler says why */ });
      child.stdin.end((system ? 'YOUR STANDING BRIEF\n' + system + '\n\n' : '') + prompt);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/') return send(req, res, 200, { helper: 'byline-helper', see: 'GET /harnesses, POST /run' });
    return send(req, res, 404, { error: 'no such route' });
  } catch (e) {
    return send(req, res, 500, { error: e.message });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('byline helper on http://127.0.0.1:' + PORT);
  console.log('  ' + (TOKEN_FROM_ENV ? 'token: set by BYLINE_HELPER_TOKEN' : 'token: ' + TOKEN + '   (made here; paste it into Byline → Settings → Local helper)'));
  console.log('  answers pages from: ' + NAMED.join(', ') + (LOOPBACK_PAGES ? ', and any http://127.0.0.1 or http://localhost port' : ''));
  for (const [id, h] of Object.entries(HARNESSES)) { const b = h.bin(); console.log('  ' + id.padEnd(12) + (b ? b.shown + '   tools: ' + h.tools : 'not installed')); }
  if (RESEARCH) console.log('  RESEARCH IS ON: Claude Code may search and fetch the web. Desk text can steer it.');
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { for (const c of running.values()) killTree(c); process.exit(0); });
