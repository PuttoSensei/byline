/* The three formats Byline gained *after* the first interop check, verified
   the same way: with other people's code.
   - jose            the JOSE implementation everyone uses, for VC-JWT
   - node:crypto     SHA-256 for the SD-JWT disclosure digests
   - canonicalize    third-party RFC 8785, for the presentation's proof
   - multiformats    third-party base58/multibase
   Nothing here is copied from Byline. */
import canonicalize from 'canonicalize';
import { base58btc } from 'multiformats/bases/base58';
import * as jose from 'jose';
import { createHash, createPublicKey, verify as nodeVerify } from 'node:crypto';
import { readFileSync } from 'node:fs';

const SRC = process.env.BYLINE_FIXTURE || new URL('./byline-formats.json', import.meta.url);
const B = JSON.parse(readFileSync(SRC, 'utf8'));
const sha256 = b => createHash('sha256').update(b).digest();
const b64u = b => Buffer.from(b).toString('base64url');
let fails = 0;
const check = (name, pass, detail) => {
  console.log(`${pass ? '  PASS' : '  FAIL'}  ${name}${detail ? '\n        ' + detail : ''}`);
  if (!pass) fails++;
};
/* report a throw as a FAIL rather than killing the run before the verdict */
const tryCheck = async (name, fn, detail) => {
  try { check(name, (await fn()) === true, detail); }
  catch (e) { check(name, false, 'threw: ' + (e && e.message)); }
};
/* pull the public key out of a did:key ourselves — Byline never tells us */
function keyFromDidKey(did) {
  const raw = base58btc.decode(String(did).split('#')[0].replace('did:key:', ''));
  if (raw[0] !== 0x80 || raw[1] !== 0x24) throw new Error('not a p256-pub did:key');
  const spki = Buffer.concat([
    Buffer.from('3039301306072a8648ce3d020106082a8648ce3d030107032200', 'hex'),
    Buffer.from(raw.slice(2))]);
  return createPublicKey({ key: spki, format: 'der', type: 'spki' });
}

/* --- 1. VC-JWT, read by jose --- */
console.log('\nVC-JWT, verified with the `jose` library');
{
  const kid = jose.decodeProtectedHeader(B.jwt).kid;
  check('the header names ES256 and a key', jose.decodeProtectedHeader(B.jwt).alg === 'ES256' && !!kid,
    `alg ES256, typ ${jose.decodeProtectedHeader(B.jwt).typ}`);
  check('the key id matches the issuer', kid.split('#')[0] === B.issuerDid, kid.slice(0, 48) + '…');
  try {
    const { payload } = await jose.compactVerify(B.jwt, keyFromDidKey(kid));
    const vc = JSON.parse(new TextDecoder().decode(payload));
    check('jose accepts the signature', true, 'verified against the key from the did:key alone');
    check('the claims arrive intact', vc.credentialSubject.name === 'Nib' && vc.issuer === B.issuerDid,
      `subject ${vc.credentialSubject.name}, harness ${vc.credentialSubject.harness}`);
  } catch (e) { check('jose accepts the signature', false, e.message); }
  // and must refuse a doctored payload
  const [h, p, s] = B.jwt.split('.');
  const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
  claims.credentialSubject.role = 'editor-in-chief';
  const forged = `${h}.${b64u(JSON.stringify(claims))}.${s}`;
  let refused = false;
  try { await jose.compactVerify(forged, keyFromDidKey(jose.decodeProtectedHeader(B.jwt).kid)); }
  catch (e) { refused = true; }
  check('and refuses a rewritten claim', refused);
}

/* --- 2. SD-JWT: the disclosure mechanism, checked from the spec --- */
console.log('\nSelective disclosure, digests recomputed independently');
{
  const parts = B.sdCombined.split('~').filter(x => x.length);
  const jwt = parts.shift();
  const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());
  const sd = payload.credentialSubject._sd || [];
  check('the credential commits to every claim as a digest', sd.length === B.allDisclosures.length,
    `${sd.length} digests for ${B.allDisclosures.length} claims`);

  await tryCheck('jose accepts the selective credential', async () => {
    const { payload: verified } = await jose.compactVerify(jwt, keyFromDidKey(jose.decodeProtectedHeader(jwt).kid));
    return !!verified;
  });

  // every disclosure's digest must be one the credential committed to
  const digestsMatch = B.allDisclosures.every(d => sd.includes(b64u(sha256(d))));
  check('each disclosure hashes to a committed digest', digestsMatch, 'base64url(sha256(disclosure))');

  // the one actually handed over reveals exactly one claim
  const revealed = parts.map(d => JSON.parse(Buffer.from(d, 'base64url').toString()));
  check('exactly one claim was handed over', revealed.length === 1,
    `${revealed[0][1]} = ${JSON.stringify(revealed[0][2])}`);

  // and the withheld values appear NOWHERE in what was sent
  const wire = B.sdCombined;
  const leaked = ['Claude Code', 'always_allow', 'My Community', 'correspondent']
    .filter(v => Buffer.from(wire).includes(v) || wire.includes(b64u(Buffer.from(v))));
  const decodedAll = jwt.split('.').map(x => { try { return Buffer.from(x, 'base64url').toString(); } catch (e) { return ''; } }).join(' ');
  const leakedDecoded = ['Claude Code', 'always_allow', 'My Community'].filter(v => decodedAll.includes(v));
  check('the withheld values are absent from the wire', leaked.length === 0 && leakedDecoded.length === 0,
    leaked.length || leakedDecoded.length ? 'LEAKED: ' + leaked.concat(leakedDecoded).join(', ') : 'searched raw and base64url-decoded');

  // an invented disclosure must not match anything
  const invented = b64u(JSON.stringify(['saltsaltsalt', 'policy', 'always_allow_everything']));
  check('an invented claim matches no digest', !sd.includes(b64u(sha256(invented))));
}

/* --- 3. Verifiable Presentation: proof of possession --- */
console.log('\nVerifiable Presentation, proof checked per ecdsa-jcs-2019');
{
  const vp = B.presentation;
  const opts = { ...vp.proof }; delete opts.proofValue;
  const doc = { ...vp }; delete doc.proof;
  const hashData = Buffer.concat([sha256(canonicalize(opts)), sha256(canonicalize(doc))]);
  const sig = base58btc.decode(vp.proof.proofValue);
  const holderKey = keyFromDidKey(vp.proof.verificationMethod);

  check('it is signed for authentication, not assertion', vp.proof.proofPurpose === 'authentication',
    vp.proof.proofPurpose);
  check('the challenge and domain are inside the signed proof',
    vp.proof.challenge === B.challenge && vp.proof.domain === B.domain,
    `challenge ${vp.proof.challenge}, domain ${vp.proof.domain}`);
  check('the holder signed it, not the issuer',
    vp.proof.verificationMethod.startsWith(B.holderDid) && B.holderDid !== B.issuerDid);
  check('node:crypto verifies the holder’s signature',
    nodeVerify('sha256', hashData, { key: holderKey, dsaEncoding: 'ieee-p1363' }, sig) === true);

  // the credential inside is still the issuer's, and still verifies
  const inner = vp.verifiableCredential[0];
  const iOpts = { ...inner.proof }; delete iOpts.proofValue;
  const iDoc = { ...inner }; delete iDoc.proof;
  const iHash = Buffer.concat([sha256(canonicalize(iOpts)), sha256(canonicalize(iDoc))]);
  check('the credential inside verifies under the issuer’s key',
    nodeVerify('sha256', iHash, { key: keyFromDidKey(inner.proof.verificationMethod), dsaEncoding: 'ieee-p1363' },
      base58btc.decode(inner.proof.proofValue)) === true);
  check('and it was issued to the holder presenting it',
    inner.credentialSubject.id === B.holderDid);

  // swapping the challenge must break the signature — this is the replay defence
  const replayed = { ...vp.proof, challenge: 'zSomeOtherChallenge' };
  delete replayed.proofValue;
  const replayHash = Buffer.concat([sha256(canonicalize(replayed)), sha256(canonicalize(doc))]);
  check('changing the challenge breaks the proof',
    nodeVerify('sha256', replayHash, { key: holderKey, dsaEncoding: 'ieee-p1363' }, sig) === false,
    'so a presentation cannot be replayed against a different challenge');
  const moved = { ...vp.proof, domain: 'https://somewhere.else' };
  delete moved.proofValue;
  const movedHash = Buffer.concat([sha256(canonicalize(moved)), sha256(canonicalize(doc))]);
  check('changing the domain breaks the proof',
    nodeVerify('sha256', movedHash, { key: holderKey, dsaEncoding: 'ieee-p1363' }, sig) === false,
    'so it cannot be re-presented at a different verifier');
}

console.log(`\n${fails ? fails + ' FAILED' : 'All checks passed'} — three formats, verified without any Byline code.\n`);
process.exit(fails ? 1 : 0);
