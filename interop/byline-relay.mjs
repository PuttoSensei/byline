/* The smallest server Byline can use, and the only one it needs.

   Three jobs, none of which the browser can do for itself:

     signalling   two browsers swap WebRTC offers and answers under a short
                  room code, instead of a person carrying two long codes
                  across by hand. The relay sees the SDP and nothing else;
                  the masthead still travels peer to peer.
     status       a signed BitstringStatusList credential is hosted at an
                  address a verifier can fetch — so a withdrawal reaches
                  anyone who re-reads the list, not only this browser.
     did:web      a DID document hosted at <host>/<name>/did.json, so a key
                  can sit behind a name that stays put when the key rotates.

     deliver      a webhook the wire fired is forwarded to its URL — a page
                  cannot POST cross-origin, a process can. Only to hosts you
                  name, and only to the public address that name resolves to:
                  the allowlist is a check on a name, and DNS decides the
                  destination, so both are checked.

   No dependencies. State lives in memory, and the two durable kinds (status
   lists, DID documents) are also written to interop/_relay.json so a restart
   does not lose them. Rooms are ephemeral by design.

     node interop/byline-relay.mjs 8126

   Then in Byline: Settings → Masthead → Relay → http://127.0.0.1:8126

   Hardening, all by environment variable:
     BYLINE_RELAY_TOKEN=secret     PUT /status, PUT /did and POST /deliver need
                                   "authorization: Bearer secret"; rooms stay open
     BYLINE_RELAY_HOOKS=a.com,b:9  hosts /deliver may forward to (default: none)
     BYLINE_RELAY_RATE=120         requests per minute per address (default 120);
                                   a guessing loop on room codes hits this first
     BYLINE_RELAY_ALLOW_PRIVATE=1  let /deliver reach private, loopback and
                                   link-local addresses. Off by default. Turn it
                                   on only when the webhook endpoint really is on
                                   this machine or this LAN, and understand that
                                   it removes the destination check: an
                                   allowlisted name whose DNS answers 127.0.0.1
                                   or 169.254.169.254 is then delivered to. */

import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { fileURLToPath } from 'node:url';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { isNonPublicIpAddress, isLocalHostname } from './public-address.mjs';

const PORT = parseInt(process.argv[2] || '8126', 10);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const STORE = process.env.BYLINE_RELAY_STORE || path.join(HERE, '_relay.json');
const ROOM_TTL = 15 * 60e3;          // a room nobody joined in fifteen minutes is gone
const POLL_MS = 20e3;                // how long a GET waits for the other side before saying "not yet"
const BODY_MAX = 256 * 1024;         // an SDP with candidates is a few KB; a status list is a few KB gzipped

const rooms = new Map();             // code → { offer, answer, waiters:{offer:[],answer:[]}, at }
let durable = { status: {}, did: {} };
try { durable = Object.assign(durable, JSON.parse(fs.readFileSync(STORE, 'utf8'))); } catch (e) { /* first run */ }
const persist = () => { try { fs.writeFileSync(STORE, JSON.stringify(durable, null, 1)); } catch (e) { /* read-only disk: still serves from memory */ } };
/* TM-008. Started without BYLINE_RELAY_TOKEN, this relay used to publish lists
   and documents, and deliver webhooks, for anyone who could reach it. Now it
   makes a token the first time it runs, keeps it in its store, and prints it:
   publishing and delivery always need one. Rooms stay open — a room code is
   its own secret, and the code comparison in the app is what tells you who
   answered it. */
const TOKEN_FROM_ENV = !!process.env.BYLINE_RELAY_TOKEN;
if (!TOKEN_FROM_ENV && !durable.token) { durable.token = randomBytes(24).toString('base64url'); persist(); }

const ALLOW_PRIVATE = /^(1|true|yes)$/i.test(process.env.BYLINE_RELAY_ALLOW_PRIVATE || '');
const DELIVER_MAX = 64 * 1024;       // what comes back from a webhook is a receipt, not a payload
const DELIVER_MS = 10e3;

/* ---------- delivering to a named host, at a checked address ----------
   An allowlist of hostnames says which names may be asked for. It says
   nothing about where those names point: a name on the list whose DNS
   answers 127.0.0.1, a LAN address, or 169.254.169.254 — which on most
   cloud hosts serves credentials to whatever asks — would be delivered to
   anyway. So the name is checked against the list, the addresses it resolves
   to are checked against public routable space, and the connection is made
   to the address that was checked, with the Host header carrying the name.
   Nothing between the check and the connection can re-point it. */
async function resolvePublic(url) {
  const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (url.username || url.password) throw new Error('a URL carrying credentials is refused');
  if (isLocalHostname(host) && !ALLOW_PRIVATE) throw new Error('a local-network name is refused: ' + host);
  const family = isIP(host);
  const addresses = family
    ? [{ address: host, family }]
    : await lookup(host, { all: true, verbatim: true });
  if (!addresses.length) throw new Error('that name resolves to nothing');
  for (const a of addresses) {
    if (a.family !== isIP(a.address)) throw new Error('that name resolved to something that is not an address');
    if (isNonPublicIpAddress(a.address) && !ALLOW_PRIVATE)
      throw new Error('that name resolves to ' + a.address + ', which is not a public address — refusing to deliver there. Set BYLINE_RELAY_ALLOW_PRIVATE=1 only if you meant a machine on this network.');
  }
  return addresses[0];
}
/* one request, to a fixed address, with a bounded reply and no redirects */
function deliverTo(url, addr, body) {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request({
      protocol: url.protocol, hostname: addr.address, family: addr.family,
      port: url.port || undefined, path: url.pathname + url.search, method: 'POST',
      headers: { host: url.host, 'content-type': 'application/json', 'user-agent': 'byline-relay',
        'content-length': Buffer.byteLength(body), 'accept-encoding': 'identity' },
      agent: false, timeout: DELIVER_MS,
      ...(url.protocol === 'https:' && !isIP(url.hostname) ? { servername: url.hostname } : {}),
    }, r => {
      let text = '', done = false;
      const settle = truncated => {
        if (done) return;
        done = true;
        resolve({ status: r.statusCode || 502, text, truncated });
      };
      r.setEncoding('utf8');
      r.on('data', c => {
        if (done) return;
        text += c;
        /* a hostile endpoint that streams for ever must not be buffered for
           ever, and must not be waited on either: settle at the cap and let
           the socket go, rather than hoping for an 'end' that never comes */
        if (text.length >= DELIVER_MAX) { text = text.slice(0, DELIVER_MAX); settle(true); r.destroy(); }
      });
      r.on('end', () => settle(false));
      r.on('close', () => settle(false));
      r.on('error', e => (done ? undefined : reject(e)));
    });
    req.on('timeout', () => req.destroy(new Error('the endpoint took longer than ten seconds')));
    req.on('error', reject);
    req.end(body);
  });
}

const CODE = /^[A-Z0-9]{4,12}$/;
const NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
const TOKEN = process.env.BYLINE_RELAY_TOKEN || durable.token;
const HOOK_HOSTS = (process.env.BYLINE_RELAY_HOOKS || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
const RATE = Math.max(1, parseInt(process.env.BYLINE_RELAY_RATE || '120', 10));

/* a token bucket per address: the cheapest thing that makes guessing room
   codes slower than the room lives, and stops one client eating the relay */
const buckets = new Map();
function allow(ip) {
  const t = Date.now();
  let b = buckets.get(ip);
  if (!b) { b = { tokens: RATE, at: t }; buckets.set(ip, b); }
  b.tokens = Math.min(RATE, b.tokens + (t - b.at) * RATE / 60e3); b.at = t;
  if (b.tokens < 1) return false;
  b.tokens -= 1; return true;
}
setInterval(() => { const cut = Date.now() - 5 * 60e3; for (const [k, b] of buckets) if (b.at < cut) buckets.delete(k); }, 60e3).unref();
const authorised = req => {
  const a = Buffer.from(String(req.headers.authorization || '')), b = Buffer.from('Bearer ' + TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
};

function send(res, status, body, type) {
  const h = { 'access-control-allow-origin': '*', 'cache-control': 'no-store' };
  if (body !== undefined) h['content-type'] = type || 'application/json';
  res.writeHead(status, h);
  res.end(body === undefined ? '' : (typeof body === 'string' ? body : JSON.stringify(body)));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', c => { n += c.length; if (n > BODY_MAX) { reject(new Error('body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
function room(code) {
  let r = rooms.get(code);
  if (!r) { r = { offer: null, answer: null, waiters: { offer: [], answer: [] }, at: Date.now() }; rooms.set(code, r); }
  return r;
}
function wake(r, kind) {
  const w = r.waiters[kind]; r.waiters[kind] = [];
  w.forEach(fn => fn());
}
setInterval(() => {
  const cut = Date.now() - ROOM_TTL;
  for (const [code, r] of rooms) if (r.at < cut) { wake(r, 'offer'); wake(r, 'answer'); rooms.delete(code); }
}, 60e3).unref();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const parts = url.pathname.split('/').filter(Boolean);
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,PUT,OPTIONS',
      'access-control-allow-headers': 'content-type, authorization', 'access-control-max-age': '600' });
    return res.end();
  }
  const ip = req.socket.remoteAddress || '?';
  if (!allow(ip)) { res.writeHead(429, { 'access-control-allow-origin': '*', 'retry-after': '10', 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: 'too many requests from this address — wait a moment' })); }
  try {
    /* ---- rooms ---- */
    if (parts[0] === 'rooms' && parts.length === 3 && (parts[2] === 'offer' || parts[2] === 'answer')) {
      const code = parts[1].toUpperCase(), kind = parts[2];
      if (!CODE.test(code)) return send(res, 400, { error: 'a room code is 4 to 12 letters or digits' });
      if (req.method === 'POST') {
        const body = await readBody(req);
        if (!body) return send(res, 400, { error: 'empty' });
        const r = room(code);
        if (r[kind]) return send(res, 409, { error: kind === 'offer' ? 'that room already has an invitation — pick another code' : 'that room already has a reply' });
        r[kind] = body; r.at = Date.now();
        wake(r, kind);
        return send(res, 201, { ok: true, code });
      }
      if (req.method === 'GET') {
        const r = room(code);
        if (r[kind]) return send(res, 200, r[kind], 'text/plain; charset=utf-8');
        /* long poll: hold the request until the other side posts, or give up politely */
        await new Promise(resolve => {
          const t = setTimeout(resolve, POLL_MS);
          r.waiters[kind].push(() => { clearTimeout(t); resolve(); });
          req.on('close', () => { clearTimeout(t); resolve(); });
        });
        if (r[kind]) return send(res, 200, r[kind], 'text/plain; charset=utf-8');
        return send(res, 204);
      }
    }
    /* ---- hosted status lists ---- */
    if (parts[0] === 'status' && parts.length === 2) {
      const id = parts[1].toLowerCase();
      if (!NAME.test(id)) return send(res, 400, { error: 'a list name is letters, digits and dashes' });
      if (req.method === 'PUT') {
        if (!authorised(req)) return send(res, 401, { error: 'this relay wants a bearer token for publishing' });
        let vc; try { vc = JSON.parse(await readBody(req)); } catch (e) { return send(res, 400, { error: 'not JSON' }); }
        const types = [].concat(vc && vc.type || []);
        if (types.indexOf('BitstringStatusListCredential') < 0 || !vc.proof || !vc.credentialSubject || !vc.credentialSubject.encodedList)
          return send(res, 422, { error: 'that is not a signed BitstringStatusListCredential' });
        /* TM-008. The relay does not judge a list's signature — whoever verifies
           does that — but it can refuse to go backwards. An older list, validly
           signed, put back over a newer one would un-withdraw every credential
           withdrawn in between, and every verifier would believe it. */
        const from = Date.parse(vc.validFrom);
        if (!(from > 0)) return send(res, 422, { error: 'a list with no validFrom cannot be ordered against the one held, so it is refused' });
        const held = durable.status[id], heldFrom = Date.parse(held && held.validFrom);
        if (heldFrom > 0 && from < heldFrom)
          return send(res, 409, { error: 'that list is older than the one held — putting it back would undo withdrawals', held: held.validFrom });
        /* the relay hosts, it does not judge: whoever verifies checks the proof */
        durable.status[id] = vc; persist();
        return send(res, 201, { ok: true, url: '/status/' + id });
      }
      if (req.method === 'GET') {
        const vc = durable.status[id];
        return vc ? send(res, 200, vc) : send(res, 404, { error: 'no list by that name' });
      }
    }
    /* ---- hosted DID documents: PUT /did/<name>, served at /<name>/did.json ---- */
    if (parts[0] === 'did' && parts.length === 2 && req.method === 'PUT') {
      const name = parts[1].toLowerCase();
      if (!NAME.test(name)) return send(res, 400, { error: 'a name is letters, digits and dashes' });
      if (!authorised(req)) return send(res, 401, { error: 'this relay wants a bearer token for publishing' });
      let doc; try { doc = JSON.parse(await readBody(req)); } catch (e) { return send(res, 400, { error: 'not JSON' }); }
      const host = (req.headers.host || ('127.0.0.1:' + PORT));
      const expect = 'did:web:' + encodeURIComponent(host) + ':' + name;
      if (!doc || doc.id !== expect) return send(res, 422, { error: 'the document must call itself ' + expect, got: doc && doc.id });
      if (!Array.isArray(doc.verificationMethod) || !doc.verificationMethod.length) return send(res, 422, { error: 'no verificationMethod' });
      durable.did[name] = doc; persist();
      return send(res, 201, { ok: true, did: expect, url: '/' + name + '/did.json' });
    }
    if (parts.length === 2 && parts[1] === 'did.json' && req.method === 'GET') {
      const doc = durable.did[parts[0].toLowerCase()];
      return doc ? send(res, 200, doc, 'application/did+json') : send(res, 404, { error: 'no document by that name' });
    }
    /* ---- webhook forwarding: the page cannot POST cross-origin; this can, to hosts you named ---- */
    if (parts[0] === 'deliver' && parts.length === 1 && req.method === 'POST') {
      if (!authorised(req)) return send(res, 401, { error: 'this relay wants a bearer token for delivery' });
      let job; try { job = JSON.parse(await readBody(req)); } catch (e) { return send(res, 400, { error: 'not JSON' }); }
      let target; try { target = new URL(String(job && job.url || '')); } catch (e) { return send(res, 400, { error: 'that is not a URL' }); }
      if (!/^https?:$/.test(target.protocol)) return send(res, 400, { error: 'only http and https are delivered' });
      if (HOOK_HOSTS.indexOf(target.host.toLowerCase()) < 0)
        return send(res, 403, { error: 'this relay does not deliver to ' + target.host + ' — name it in BYLINE_RELAY_HOOKS', allowed: HOOK_HOSTS });
      let addr;
      try { addr = await resolvePublic(target); }
      catch (e) { return send(res, 403, { error: e.message }); }
      try {
        const r = await deliverTo(target, addr, JSON.stringify(job.body == null ? {} : job.body));
        return send(res, 200, Object.assign({ ok: r.status >= 200 && r.status < 300, status: r.status,
          body: r.text.slice(0, 2048), to: addr.address }, r.truncated ? { truncated: true } : {}));
      } catch (e) { return send(res, 502, { ok: false, error: e.message }); }
    }
    if (parts.length === 0) return send(res, 200,
      'byline relay\n\n' +
      'POST /rooms/<code>/offer     GET /rooms/<code>/offer   (long-poll)\n' +
      'POST /rooms/<code>/answer    GET /rooms/<code>/answer  (long-poll)\n' +
      'PUT  /status/<name>          GET /status/<name>\n' +
      'PUT  /did/<name>             GET /<name>/did.json\n' +
      'POST /deliver                {url, body} → forwarded to a host in BYLINE_RELAY_HOOKS' + (HOOK_HOSTS.length ? ' (' + HOOK_HOSTS.join(', ') + ')' : ' (none named)') + '\n' +
      '                             ...and only to the public address that name resolves to\n\n' +
      'publishing and delivery need the bearer token' + (TOKEN_FROM_ENV ? '' : ' this relay made (printed when it started)') + '\n' +
      (ALLOW_PRIVATE ? 'delivery may reach PRIVATE addresses (BYLINE_RELAY_ALLOW_PRIVATE is on)\n' : 'delivery reaches public addresses only\n') +
      'rate: ' + RATE + ' requests a minute per address\n' +
      'rooms live ' + (ROOM_TTL / 60e3) + ' minutes; lists and documents persist in ' + path.basename(STORE) + '\n', 'text/plain; charset=utf-8');
    return send(res, 404, { error: 'no such route' });
  } catch (e) {
    return send(res, e.message === 'body too large' ? 413 : 500, { error: e.message });
  }
});
server.listen(PORT, '127.0.0.1', () => {
  console.log('byline relay on http://127.0.0.1:' + PORT + '  (' + Object.keys(durable.status).length + ' lists, ' + Object.keys(durable.did).length + ' documents; ' + (TOKEN_FROM_ENV ? 'token set' : 'token: ' + TOKEN + ' (made here — set BYLINE_RELAY_TOKEN to choose your own)') + '; hooks: ' + (HOOK_HOSTS.join(', ') || 'none') + (ALLOW_PRIVATE ? '; PRIVATE DELIVERY ALLOWED' : '') + ')');
});
