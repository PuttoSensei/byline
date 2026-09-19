/* Drives byline-relay.mjs the way a hostile client would, and the way the
   app does. Starts a relay on a spare port with a token, a hook allowlist
   and a low rate, then checks each guard from the outside.

     node interop/relay-test.mjs
*/
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/* every relay here keeps its lists, documents and any token it makes in a
   store of its own, so a test run never writes into the real one */
const STORE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'byline-relay-'));
const PORT = 8300 + Math.floor(Math.random() * 500);
const RATE = 40;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✕ ' + m); } };

/* a receiver on the allowlist, and one that is not */
const got = [];
let flooding = null;
const receiver = http.createServer((req, res) => {
  let b = '';
  req.on('data', d => b += d).on('end', () => {
    /* /flood answers for ever: the relay must stop reading rather than grow */
    if (req.url === '/flood') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      const chunk = 'x'.repeat(16 * 1024);
      flooding = setInterval(() => { if (!res.write(chunk)) { /* backpressure: keep going anyway */ } }, 1);
      flooding.unref();                       // never the reason the process stays up
      res.on('close', () => { clearInterval(flooding); flooding = null; });
      return;
    }
    got.push({ path: req.url, body: b });
    res.writeHead(200); res.end('received');
  });
});
await new Promise(r => receiver.listen(0, '127.0.0.1', r));
const RPORT = receiver.address().port;

/* Two relays. The first is the default: an allowlisted name still has to
   resolve to a public address. The second opts in to private delivery, which
   is the only way a webhook receiver on this machine can be reached — and the
   only way this test can prove a delivery succeeds at all. */
const env = extra => Object.assign({}, process.env, {
  BYLINE_RELAY_TOKEN: 'sesame',
  BYLINE_RELAY_HOOKS: '127.0.0.1:' + RPORT + ',localhost:' + RPORT + ',hooks.invalid',
  BYLINE_RELAY_RATE: String(RATE),
  BYLINE_RELAY_ALLOW_PRIVATE: '',
  BYLINE_RELAY_STORE: path.join(STORE_DIR, 'store-' + Math.random().toString(36).slice(2) + '.json'),
}, extra || {});
const relay = spawn(process.execPath, [path.join(HERE, 'byline-relay.mjs'), String(PORT)], {
  env: env(), stdio: ['ignore', 'pipe', 'ignore'],
});
await new Promise(r => relay.stdout.once('data', r));
const LOOSE_PORT = PORT + 1;
const loose = spawn(process.execPath, [path.join(HERE, 'byline-relay.mjs'), String(LOOSE_PORT)], {
  env: env({ BYLINE_RELAY_ALLOW_PRIVATE: '1' }), stdio: ['ignore', 'pipe', 'ignore'],
});
await new Promise(r => loose.stdout.once('data', r));
const base = 'http://127.0.0.1:' + PORT;
const looseBase = 'http://127.0.0.1:' + LOOSE_PORT;
const looseCall = (p, body) => fetch(looseBase + p, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer sesame' }, body: JSON.stringify(body) });
const call = (method, p, body, headers) => fetch(base + p, { method, headers: Object.assign({ 'content-type': 'application/json' }, headers || {}), body: body == null ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) });

try {
  console.log('token');
  let r = await call('PUT', '/status/x', { type: ['VerifiableCredential', 'BitstringStatusListCredential'], proof: {}, validFrom: new Date(Date.now() - 60e3).toISOString(), credentialSubject: { encodedList: 'u' } });
  ok(r.status === 401, 'publishing without the token is refused (' + r.status + ')');
  r = await call('PUT', '/status/x', { type: ['VerifiableCredential', 'BitstringStatusListCredential'], proof: {}, validFrom: new Date(Date.now() - 60e3).toISOString(), credentialSubject: { encodedList: 'u' } }, { authorization: 'Bearer sesame' });
  ok(r.status === 201, 'and accepted with it (' + r.status + ')');
  r = await call('GET', '/status/x');
  ok(r.status === 200, 'reading needs no token (' + r.status + ')');
  r = await call('POST', '/rooms/ABCDEF/offer', 'offer-bytes', { 'content-type': 'text/plain' });
  ok(r.status === 201, 'rooms stay open without a token (' + r.status + ')');

  /* TM-008. The relay hosts lists and does not judge them, so it accepted any
     signed list for a name — including an older one, which would un-withdraw
     every credential withdrawn since. */
  console.log('replay');
  const list = at => ({ type: ['VerifiableCredential', 'BitstringStatusListCredential'], proof: {}, validFrom: new Date(at).toISOString(), credentialSubject: { encodedList: 'u' } });
  const auth = { authorization: 'Bearer sesame' };
  r = await call('PUT', '/status/replay', list(Date.now() - 10 * 60e3), auth);
  ok(r.status === 201, 'a list is hosted (' + r.status + ')');
  r = await call('PUT', '/status/replay', list(Date.now()), auth);
  ok(r.status === 201, 'a newer one replaces it (' + r.status + ')');
  r = await call('PUT', '/status/replay', list(Date.now() - 5 * 60e3), auth);
  ok(r.status === 409, 'an older one is refused, so a withdrawal cannot be undone by putting the old list back (' + r.status + ')');
  r = await call('PUT', '/status/replay', { type: ['VerifiableCredential', 'BitstringStatusListCredential'], proof: {}, credentialSubject: { encodedList: 'u' } }, auth);
  ok(r.status === 422, 'and a list with no issue date cannot be ordered, so it is refused (' + r.status + ')');

  /* TM-008. A relay started without BYLINE_RELAY_TOKEN published and delivered
     for anyone who could reach it. */
  console.log('no token set');
  const bare = spawn(process.execPath, [path.join(HERE, 'byline-relay.mjs'), String(PORT + 2)], {
    env: env({ BYLINE_RELAY_TOKEN: '' }), stdio: ['ignore', 'pipe', 'ignore'],
  });
  const banner = await new Promise(res => bare.stdout.once('data', d => res(String(d))));
  try {
    const m = /token: (\S+)/.exec(banner), made = m ? m[1] : '';
    ok(made.length >= 16, 'a relay started without a token makes one, and prints it (' + (made ? made.length + ' characters' : 'none: ' + banner.trim().slice(0, 80)) + ')');
    const bb = 'http://127.0.0.1:' + (PORT + 2);
    let x = await fetch(bb + '/status/y', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(list(Date.now())) });
    ok(x.status === 401, 'publishing without it is refused all the same (' + x.status + ')');
    x = await fetch(bb + '/status/y', { method: 'PUT', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + made }, body: JSON.stringify(list(Date.now())) });
    ok(x.status === 201, 'while the token it printed works (' + x.status + ')');
    x = await fetch(bb + '/deliver', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: 'http://example.com/x' }) });
    ok(x.status === 401, 'and so is delivering without it (' + x.status + ')');
  } finally { bare.stdout.destroy(); bare.kill(); await new Promise(r => bare.once('exit', r)); }

  console.log('delivery');
  r = await call('POST', '/deliver', { url: 'http://127.0.0.1:' + RPORT + '/hook', body: { hello: 'wire' } });
  ok(r.status === 401, 'delivery without the token is refused (' + r.status + ')');
  r = await call('POST', '/deliver', { url: 'http://example.com/hook', body: {} }, { authorization: 'Bearer sesame' });
  ok(r.status === 403, 'a host not on the list is refused (' + r.status + ')');
  r = await call('POST', '/deliver', { url: 'file:///etc/passwd' }, { authorization: 'Bearer sesame' });
  ok(r.status === 400, 'a non-http scheme is refused (' + r.status + ')');

  console.log('destination');
  /* the allowlist is a check on a NAME. This is the check on where the name goes. */
  r = await call('POST', '/deliver', { url: 'http://127.0.0.1:' + RPORT + '/hook', body: { hello: 'wire' } }, { authorization: 'Bearer sesame' });
  let j = await r.json();
  ok(r.status === 403 && /not a public address/.test(j.error || ''), 'an allowlisted name at a loopback address is refused (' + r.status + ': ' + (j.error || '').slice(0, 60) + '…)');
  ok(got.length === 0, 'and the receiver was never contacted');
  r = await call('POST', '/deliver', { url: 'http://localhost:' + RPORT + '/hook' }, { authorization: 'Bearer sesame' });
  j = await r.json();
  ok(r.status === 403 && /local-network name/.test(j.error || ''), 'a local name is refused before DNS is even asked (' + r.status + ')');
  r = await call('POST', '/deliver', { url: 'http://hooks.invalid/x' }, { authorization: 'Bearer sesame' });
  ok(r.status === 403, 'an allowlisted name that resolves to nothing is refused, not attempted (' + r.status + ')');

  console.log('delivery, with private addresses explicitly allowed');
  r = await looseCall('/deliver', { url: 'http://127.0.0.1:' + RPORT + '/hook', body: { hello: 'wire' } });
  j = await r.json();
  ok(r.status === 200 && j.ok && j.status === 200 && j.body === 'received', 'the opted-in relay delivers (' + JSON.stringify(j) + ')');
  ok(j.to === '127.0.0.1', 'and reports the address it actually connected to (' + j.to + ')');
  ok(got.length === 1 && got[0].path === '/hook' && JSON.parse(got[0].body).hello === 'wire', 'and the receiver saw the body');
  r = await looseCall('/deliver', { url: 'http://127.0.0.1:' + RPORT + '/flood' });
  j = await r.json();
  ok(j.truncated === true && j.body.length <= 2048, 'a reply that streams for ever is cut off rather than buffered (' + j.body.length + ' bytes kept, truncated ' + j.truncated + ')');

  console.log('rate');
  let limited = 0, seen = 0;
  /* a room GET long-polls for twenty seconds, so a guesser who wants speed asks for something that answers at once */
  for (let i = 0; i < RATE + 20; i++) { const x = await fetch(base + '/status/guess-' + i); seen++; if (x.status === 429) { limited++; ok(x.headers.get('retry-after') === '10', 'the 429 says when to come back'); break; } }
  ok(limited === 1 && seen <= RATE + 1, 'a guessing loop is cut off at the rate (' + seen + ' requests)');
} finally {
  /* tear down in order: Windows libuv asserts if a child dies while a server is mid-close */
  if (flooding) clearInterval(flooding);
  relay.stdout.destroy(); relay.kill(); await new Promise(r => relay.once('exit', r));
  loose.stdout.destroy(); loose.kill(); await new Promise(r => loose.once('exit', r));
  receiver.closeAllConnections?.();
  await new Promise(r => receiver.close(r));
  try { fs.rmSync(STORE_DIR, { recursive: true, force: true }); } catch (e) { }
}
console.log(`\n${pass} pass, ${fail} fail`);
process.exitCode = fail ? 1 : 0;          // no process.exit: Node 24 on Windows asserts in libuv if a pipe is still closing
