/* Verifies a Byline credential using nobody's code but other people's.
   - canonicalize        third-party RFC 8785 (JCS)
   - multiformats        third-party base58btc / multibase
   - @digitalbazaar/*    the reference Data Integrity implementation
   - node:crypto         ECDSA P-256
   Nothing here was copied from Byline; if Byline's format is idiosyncratic,
   this fails. */
import canonicalize from 'canonicalize';
import { base58btc } from 'multiformats/bases/base58';
import * as EcdsaMultikey from '@digitalbazaar/ecdsa-multikey';
import * as DidKey from '@digitalbazaar/did-method-key';
import { createHash, createPublicKey, verify as nodeVerify } from 'node:crypto';
import { readFileSync } from 'node:fs';

/* BYLINE_FIXTURE lets falsify.mjs point this at a deliberately broken copy
   without touching the real one. */
const SRC = process.env.BYLINE_FIXTURE || new URL('./byline-credentials.json', import.meta.url);
const bundle = JSON.parse(readFileSync(SRC, 'utf8'));
const sha256 = b => createHash('sha256').update(b).digest();
let fails = 0;
const check = (name, pass, detail) => {
  console.log(`${pass ? '  PASS' : '  FAIL'}  ${name}${detail ? '\n        ' + detail : ''}`);
  if (!pass) fails++;
};
/* A check whose expression can throw must still report as a FAIL rather than
   killing the run — a crash prints no verdict, and a missing verdict is easy
   to read as an absent problem. */
const tryCheck = (name, fn, detail) => {
  try { check(name, fn() === true, detail); }
  catch (e) { check(name, false, 'threw: ' + (e && e.message)); }
};

/* --- 1. does a third-party JCS agree byte-for-byte with Byline's? --- */
console.log('\nRFC 8785 canonicalisation, checked against the `canonicalize` package');
{
  const doc = { ...bundle.correspondent }; delete doc.proof;
  const opts = { ...bundle.correspondent.proof }; delete opts.proofValue;
  const theirsDoc = canonicalize(doc), theirsProof = canonicalize(opts);
  check('document canonicalises identically', theirsDoc === bundle.bylineJcsDoc,
    theirsDoc === bundle.bylineJcsDoc ? `${theirsDoc.length} bytes, identical`
      : `theirs: ${theirsDoc.slice(0, 160)}\n        byline: ${bundle.bylineJcsDoc.slice(0, 160)}`);
  check('proof config canonicalises identically', theirsProof === bundle.bylineJcsProof,
    theirsProof === bundle.bylineJcsProof ? `${theirsProof.length} bytes, identical` : `theirs: ${theirsProof}`);
}

/* --- 2. can a real did:key resolver read Byline's identifiers? --- */
console.log('\ndid:key resolution, via @digitalbazaar/did-method-key');
const driver = DidKey.driver();
driver.use({ multibaseMultikeyHeader: 'zDna', fromMultibase: EcdsaMultikey.from });
let dbKey = null;
{
  const vm = bundle.correspondent.proof.verificationMethod;
  const did = vm.split('#')[0];
  try {
    const didDoc = await driver.get({ did });
    const m = didDoc.verificationMethod?.[0] ?? didDoc.assertionMethod?.[0];
    check('the DID document resolves', !!m, `id ${String(m?.id ?? didDoc.id).slice(0, 60)}…`);
    check('it is declared a P-256 Multikey', String(m?.type) === 'Multikey', `type ${m?.type}`);
    dbKey = await EcdsaMultikey.from(m);
    check('the public key imports', !!dbKey, `curve ${dbKey?.publicKeyMultibase?.slice(0, 8)}…`);
    check('the verification method matches the DID it came from', m?.id === vm,
      m?.id === vm ? vm.slice(0, 54) + '…' : `resolver says ${m?.id}\n        byline says  ${vm}`);
  } catch (e) { check('the DID document resolves', false, e.message); }
}

/* --- 3. the multicodec framing, decoded independently --- */
console.log('\nmultibase / multicodec framing, via multiformats');
tryCheck('framed with the p256-pub multicodec 0x1200', () => {
  const did = bundle.correspondent.proof.verificationMethod.split('#')[0];
  const raw = base58btc.decode(did.replace('did:key:', ''));
  return raw[0] === 0x80 && raw[1] === 0x24;
});
tryCheck('carries a compressed P-256 point', () => {
  const did = bundle.correspondent.proof.verificationMethod.split('#')[0];
  const raw = base58btc.decode(did.replace('did:key:', ''));
  return raw.length === 35 && (raw[2] === 2 || raw[2] === 3);
});

/* --- 4. the actual signature, per the ecdsa-jcs-2019 spec --- */
console.log('\necdsa-jcs-2019 proof verification');
for (const [label, vc] of Object.entries(bundle).filter(([k, v]) => v && v.proof)) {
  const doc = { ...vc }; delete doc.proof;
  const opts = { ...vc.proof }; delete opts.proofValue;
  // spec: hashData = sha256(canonical proof config) || sha256(canonical document)
  const hashData = Buffer.concat([sha256(canonicalize(opts)), sha256(canonicalize(doc))]);
  let sig = null;
  tryCheck(`${label}: proofValue is a 64-byte raw (r||s) signature`, () => {
    sig = base58btc.decode(vc.proof.proofValue);
    return sig.length === 64;
  });

  let dbOk = null;
  try { dbOk = await (dbKey.verifier()).verify({ data: hashData, signature: sig }); } catch (e) { dbOk = e.message; }
  check(`${label}: @digitalbazaar/ecdsa-multikey verifies it`, dbOk === true, `returned ${dbOk}`);

  // and again through node's own crypto, from the key bytes alone
  let pub = null;
  tryCheck(`${label}: node:crypto verifies it from the did:key alone`, () => {
    const did = vc.proof.verificationMethod.split('#')[0];
    const point = Buffer.from(base58btc.decode(did.replace('did:key:', '')).slice(2));
    const spki = Buffer.concat([
      Buffer.from('3039301306072a8648ce3d020106082a8648ce3d030107032200', 'hex'), point]);
    pub = createPublicKey({ key: spki, format: 'der', type: 'spki' });
    return nodeVerify('sha256', hashData, { key: pub, dsaEncoding: 'ieee-p1363' }, sig) === true;
  });

  // and must refuse a tampered claim
  tryCheck(`${label}: refuses the same proof over an altered claim`, () => {
    const tampered = { ...doc, credentialSubject: { ...doc.credentialSubject, name: 'Someone Else' } };
    const badHash = Buffer.concat([sha256(canonicalize(opts)), sha256(canonicalize(tampered))]);
    return nodeVerify('sha256', badHash, { key: pub, dsaEncoding: 'ieee-p1363' }, sig) === false;
  });
}

console.log(`\n${fails ? fails + ' FAILED' : 'All checks passed'} — verified without any Byline code.\n`);
process.exit(fails ? 1 : 0);
