/* An SD-JWT VC presentation from Byline, checked against
   draft-ietf-oauth-sd-jwt-vc with nobody's code but jose, multiformats and
   node:crypto. The fixture is what the in-browser test produced: a
   presentation with a key-binding JWT, the verifier's audience and nonce.

     node interop/verify-sdjwt.mjs
*/
import { base58btc } from 'multiformats/bases/base58';
import * as jose from 'jose';
import { createHash, createPublicKey } from 'node:crypto';
import { readFileSync } from 'node:fs';

const SRC = process.env.BYLINE_FIXTURE || new URL('./byline-sdjwt.json', import.meta.url);
const B = JSON.parse(readFileSync(SRC, 'utf8'));
const sha256 = b => createHash('sha256').update(b).digest();
const b64u = b => Buffer.from(b).toString('base64url');
let fails = 0;
const check = (name, pass, detail) => { console.log(`${pass ? '  PASS' : '  FAIL'}  ${name}${detail ? '\n        ' + detail : ''}`); if (!pass) fails++; };
function keyFromDidKey(did) {
  const raw = base58btc.decode(String(did).split('#')[0].replace('did:key:', ''));
  if (raw[0] !== 0x80 || raw[1] !== 0x24) throw new Error('not a p256-pub did:key');
  const spki = Buffer.concat([Buffer.from('3039301306072a8648ce3d020106082a8648ce3d030107032200', 'hex'), Buffer.from(raw.slice(2))]);
  return createPublicKey({ key: spki, format: 'der', type: 'spki' });
}

console.log('\nSD-JWT VC presentation, read per draft-ietf-oauth-sd-jwt-vc');
const parts = B.presentation.split('~');
const kb = parts.pop();
const issuerJwt = parts.shift();
const disclosures = parts.filter(Boolean);
check('the presentation ends in a key-binding JWT', kb.split('.').length === 3, `${disclosures.length} disclosure(s) presented`);

const head = jose.decodeProtectedHeader(issuerJwt);
check('the issuer JWT is typed dc+sd-jwt', head.typ === 'dc+sd-jwt' || head.typ === 'vc+sd-jwt', `typ ${head.typ}, alg ${head.alg}`);
let claims = null;
try {
  const { payload } = await jose.compactVerify(issuerJwt, keyFromDidKey(head.kid));
  claims = JSON.parse(new TextDecoder().decode(payload));
  check('jose verifies the issuer signature from the did:key alone', true, `iss ${claims.iss.slice(0, 30)}…`);
} catch (e) { check('jose verifies the issuer signature from the did:key alone', false, e.message); }
check('the issuer is who the fixture says', claims && claims.iss === B.issuerDid);
check('vct, cnf.jwk and _sd_alg are present', claims && !!claims.vct && !!(claims.cnf && claims.cnf.jwk) && claims._sd_alg === 'sha-256',
  claims && `vct ${claims.vct}, ${(claims._sd || []).length} digests`);

/* disclosures: each must hash to a committed digest, and the withheld ones must be absent */
const sd = (claims && claims._sd) || [];
check('every presented disclosure hashes to a committed digest', disclosures.every(d => sd.includes(b64u(sha256(d)))));
const revealed = disclosures.map(d => JSON.parse(Buffer.from(d, 'base64url').toString()));
check('exactly one claim was handed over', revealed.length === 1, revealed.map(r => `${r[1]} = ${JSON.stringify(r[2])}`).join(', '));
const withheld = B.allDisclosures.filter(d => !disclosures.includes(d)).map(d => JSON.parse(Buffer.from(d, 'base64url').toString()));
const leaked = withheld.filter(w => B.presentation.includes(JSON.stringify(w[2])) || B.presentation.includes(b64u(JSON.stringify(w[2]))));
check('the withheld claims are nowhere on the wire', leaked.length === 0, `${withheld.length} withheld, searched raw and base64url`);

/* key binding: signed by cnf.jwk, over the exact string presented, for this audience and nonce */
const kbHead = jose.decodeProtectedHeader(kb);
check('the key-binding JWT is typed kb+jwt', kbHead.typ === 'kb+jwt');
let kbClaims = null;
try {
  const holderKey = await jose.importJWK(claims.cnf.jwk, 'ES256');
  const { payload } = await jose.compactVerify(kb, holderKey);
  kbClaims = JSON.parse(new TextDecoder().decode(payload));
  check('jose verifies the key binding with cnf.jwk, not with anything the holder claimed', true);
} catch (e) { check('jose verifies the key binding with cnf.jwk, not with anything the holder claimed', false, e.message); }
check('it answers the verifier\'s audience and nonce', kbClaims && kbClaims.aud === B.aud && kbClaims.nonce === B.nonce,
  kbClaims && `aud ${kbClaims.aud}, nonce ${String(kbClaims.nonce).slice(0, 12)}…`);
const presentedBody = B.presentation.slice(0, B.presentation.lastIndexOf('~') + 1);
check('sd_hash is the hash of exactly what was presented', kbClaims && kbClaims.sd_hash === b64u(sha256(presentedBody)));

/* and the holder key in cnf is the holder's did:key */
try {
  const fromDid = keyFromDidKey(B.holderDid).export({ format: 'jwk' });
  check('cnf.jwk is the key the holder\'s did:key names', fromDid.x === claims.cnf.jwk.x && fromDid.y === claims.cnf.jwk.y);
} catch (e) { check('cnf.jwk is the key the holder\'s did:key names', false, e.message); }

/* a swapped disclosure must break the binding */
const other = B.allDisclosures.find(d => !disclosures.includes(d));
if (other) {
  const swapped = presentedBody + other + '~';
  check('adding a disclosure after binding changes sd_hash', b64u(sha256(swapped)) !== kbClaims.sd_hash);
}

console.log(fails ? `\n${fails} FAILED` : '\nAll pass.');
process.exitCode = fails ? 1 : 0;
