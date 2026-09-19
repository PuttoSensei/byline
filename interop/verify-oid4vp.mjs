/* A real OpenID4VP exchange, checked against the 1.0 final spec by code that
   has never seen Byline. Everything is derived from two strings: the signed
   request object, and the form body the wallet posted back.

   The rules being enforced come from the spec itself:
     · request object header typ MUST be `oauth-authz-req+jwt`
     · client_id carries its prefix; for `decentralized_identifier` the request
       MUST be signed by the key that DID names
     · vp_token is keyed by the DCQL query id, values are arrays
     · Appendix B, ldp_vc: challenge MUST be the nonce, domain MUST be the
       Client Identifier, proofPurpose MUST be authentication  */
import canonicalize from 'canonicalize';
import { base58btc } from 'multiformats/bases/base58';
import * as jose from 'jose';
import { createHash, createPublicKey, verify as nodeVerify } from 'node:crypto';
import { readFileSync } from 'node:fs';

const SRC = process.env.BYLINE_FIXTURE || new URL('./byline-oid4vp.json', import.meta.url);
const B = JSON.parse(readFileSync(SRC, 'utf8'));
const sha256 = b => createHash('sha256').update(b).digest();
let fails = 0;
const check = (name, pass, detail) => {
  console.log(`${pass ? '  PASS' : '  FAIL'}  ${name}${detail ? '\n        ' + detail : ''}`);
  if (!pass) fails++;
};
const tryCheck = (name, fn, detail) => {
  try { check(name, fn() === true, detail); }
  catch (e) { check(name, false, 'threw: ' + (e && e.message)); }
};
function keyFromDidKey(did) {
  const raw = base58btc.decode(String(did).split('#')[0].replace('did:key:', ''));
  if (raw[0] !== 0x80 || raw[1] !== 0x24) throw new Error('not a p256-pub did:key');
  return createPublicKey({ key: Buffer.concat([
    Buffer.from('3039301306072a8648ce3d020106082a8648ce3d030107032200', 'hex'),
    Buffer.from(raw.slice(2))]), format: 'der', type: 'spki' });
}
const diVerify = (doc, proof, key) => {
  const opts = { ...proof }; delete opts.proofValue;
  const body = { ...doc }; delete body.proof;
  const hashData = Buffer.concat([sha256(canonicalize(opts)), sha256(canonicalize(body))]);
  return nodeVerify('sha256', hashData, { key, dsaEncoding: 'ieee-p1363' },
    base58btc.decode(proof.proofValue));
};

/* --- the request --- */
console.log('\nAuthorization Request object');
const head = jose.decodeProtectedHeader(B.requestJwt);
check('typ is oauth-authz-req+jwt', head.typ === 'oauth-authz-req+jwt', head.typ);
check('signed with ES256', head.alg === 'ES256', head.alg);
let req = null;
try {
  const { payload } = await jose.compactVerify(B.requestJwt, keyFromDidKey(head.kid));
  req = JSON.parse(new TextDecoder().decode(payload));
  check('jose verifies the request signature', true, 'against the key inside the did:key');
} catch (e) { check('jose verifies the request signature', false, e.message); }

tryCheck('response_type is vp_token', () => req.response_type === 'vp_token');
tryCheck('client_id carries its prefix', () => req.client_id.startsWith('decentralized_identifier:'));
tryCheck('and the signing key is the one client_id names',
  () => head.kid.split('#')[0] === req.client_id.replace(/^[a-z_]+:/, ''),
  'otherwise anyone could ask in someone else’s name');
tryCheck('a nonce is present to bind the answer', () => !!req.nonce, req && req.nonce);
tryCheck('the query is DCQL', () => !!req.dcql_query && Array.isArray(req.dcql_query.credentials));
const q = ((req.dcql_query || {}).credentials || [{}])[0];
tryCheck('the query names a format and an id', () => q.format === 'ldp_vc' && !!q.id, `${q.id} / ${q.format}`);

/* --- the response --- */
console.log('\nAuthorization Response (direct_post, form-encoded)');
const form = new URLSearchParams(B.formBody);
tryCheck('the body is form-encoded with a vp_token', () => !!form.get('vp_token'),
  'application/x-www-form-urlencoded');
tryCheck('state is echoed back unchanged', () => form.get('state') === req.state, form.get('state'));
let vpToken = {};
try { vpToken = JSON.parse(form.get('vp_token')); } catch (e) { /* checks below report it */ }
tryCheck('vp_token is keyed by the DCQL query id', () => Object.keys(vpToken)[0] === q.id,
  `key "${Object.keys(vpToken)[0]}"`);
tryCheck('and its value is an array', () => Array.isArray(vpToken[q.id]));

/* --- Appendix B: how the presentation must be bound --- */
console.log('\nAppendix B binding for ldp_vc');
const vp = ((vpToken[q.id] || [])[0]) || { proof: {}, verifiableCredential: [] };
tryCheck('challenge is the nonce from the request', () => vp.proof.challenge === req.nonce,
  `${vp.proof.challenge}`);
tryCheck('domain is the whole Client Identifier, prefix included',
  () => vp.proof.domain === req.client_id);
tryCheck('proofPurpose is authentication', () => vp.proof.proofPurpose === 'authentication',
  vp.proof.proofPurpose);

/* --- the cryptography, done independently --- */
console.log('\nSignatures, verified with node:crypto');
let holderKey = null;
tryCheck('the holder’s signature over the presentation holds', () => {
  holderKey = keyFromDidKey(vp.proof.verificationMethod);
  return diVerify(vp, vp.proof, holderKey) === true;
});
const vc = (vp.verifiableCredential || [])[0] || { proof: {}, credentialSubject: {} };
tryCheck('the credential inside holds under its issuer’s key',
  () => diVerify(vc, vc.proof, keyFromDidKey(vc.proof.verificationMethod)) === true);
tryCheck('the credential was issued to the holder presenting it',
  () => vc.credentialSubject.id === vp.holder, 'so this is not a copy of someone else’s');
tryCheck('the claims the verifier asked for are all there',
  () => (q.claims || []).every(c => c.path.reduce((o, k) => (o == null ? o : o[k]), vc) !== undefined),
  (q.claims || []).map(c => c.path.join('.')).join(', '));

/* --- the two attacks the binding exists to stop --- */
console.log('\nReplay and misdirection');
tryCheck('a different nonce breaks the proof',
  () => diVerify(vp, { ...vp.proof, challenge: 'zSomeoneElsesNonce' }, holderKey) === false,
  'so the answer cannot be replayed against another request');
tryCheck('a different verifier breaks the proof',
  () => diVerify(vp, { ...vp.proof, domain: 'decentralized_identifier:did:key:zAttacker' }, holderKey) === false,
  'so it cannot be forwarded to a verifier it was not meant for');

console.log(`\n${fails ? fails + ' FAILED' : 'All checks passed'} — a full OpenID4VP exchange, verified without any Byline code.\n`);
process.exit(fails ? 1 : 0);
