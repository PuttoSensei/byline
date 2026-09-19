// Runs Byline's own NIP-OA code — lifted out of byline.html, not rewritten —
// so interop/verify-nipoa.py can put it against libsecp256k1.
//   node nipoa-byline.mjs sign   cases.json   -> tags Byline signs
//   node nipoa-byline.mjs verify cases.json   -> Byline's verdict on each tag
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../byline.html', import.meta.url), 'utf8');
const cut = (a, b) => {
  const i = html.indexOf(a), j = html.indexOf(b, i);
  if (i < 0 || j < 0) throw new Error('marker missing in byline.html: ' + a);
  return html.slice(i, j + b.length);
};
const code = cut('/* ==== vendored: @noble/secp256k1', '/* ==== end vendored ==== */') + '\n' +
             cut('/* ==== NIP-OA ==== */', '/* ==== end NIP-OA ==== */');
const shim = `
  const SUBTLE = globalThis.crypto.subtle;
  const encU = s => new TextEncoder().encode(s);
  const toHex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
  const unHex = h => new Uint8Array((String(h).match(/../g) || []).map(x => parseInt(x, 16)));
  const unb64u = s => Uint8Array.from(Buffer.from(String(s), 'base64url'));
  const S = { people: {}, meId: null };`;
// `new Function` evaluates only this repository's own byline.html, cut between
// fixed markers above — no argument, file content or network input reaches it.
// Dev tooling; it never ships.
const api = new Function(shim + code + '\nreturn { nipoaSign, nipoaVerifyTag, nipoaHash };')();

const [mode, file] = process.argv.slice(2);
const cases = JSON.parse(fs.readFileSync(file, 'utf8'));
const out = [];
if (mode === 'sign') {
  for (const c of cases) out.push(await api.nipoaSign(c.owner, c.agent, c.conditions, c.aux));
} else if (mode === 'verify') {
  for (const c of cases) { const r = await api.nipoaVerifyTag(c.tag, c.event); out.push({ ok: r.ok, why: r.why || null }); }
} else throw new Error('mode is sign or verify');
process.stdout.write(JSON.stringify(out));
