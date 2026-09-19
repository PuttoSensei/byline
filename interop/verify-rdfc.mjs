/* ecdsa-rdfc-2019, checked with nobody's code but Digital Bazaar's, jsonld.js
   and rdf-canonize. Three things are settled here:
     1. Byline's canonical N-Quads for the document and for the proof options
        are byte-identical to jsonld.toRDF + RDFC-1.0 from the reference stack.
     2. A credential Byline signed under ecdsa-rdfc-2019 verifies in
        @digitalbazaar/vc with the reference cryptosuite, given nothing but
        the did:key.
     3. A credential the reference stack signs is written out, so the
        in-browser suite can prove the other direction (Byline verifying it).

     node interop/verify-rdfc.mjs            # 1 and 2 against byline-rdfc.json
     node interop/verify-rdfc.mjs --issue    # also 3: writes byline-rdfc-in.json
*/
import { readFileSync, writeFileSync } from 'node:fs';
import jsonld from 'jsonld';
import * as rdfCanonize from 'rdf-canonize';
import { contexts } from '@digitalbazaar/credentials-context';
import * as vcjs from '@digitalbazaar/vc';
import { DataIntegrityProof } from '@digitalbazaar/data-integrity';
import { cryptosuite as ecdsaRdfc2019 } from '@digitalbazaar/ecdsa-rdfc-2019-cryptosuite';
import * as EcdsaMultikey from '@digitalbazaar/ecdsa-multikey';
import * as DidKey from '@digitalbazaar/did-method-key';

const SRC = process.env.BYLINE_FIXTURE || new URL('./byline-rdfc.json', import.meta.url);
const B = JSON.parse(readFileSync(SRC, 'utf8'));
let fails = 0;
const check = (name, pass, detail) => { console.log(`${pass ? '  PASS' : '  FAIL'}  ${name}${detail ? '\n        ' + detail : ''}`); if (!pass) fails++; };

const driver = DidKey.driver();
driver.use({ multibaseMultikeyHeader: 'zDna', fromMultibase: EcdsaMultikey.from });
const documentLoader = async url => {
  if (contexts.has(url)) return { contextUrl: null, documentUrl: url, document: contexts.get(url) };
  if (url.startsWith('did:key:')) {
    const did = url.split('#')[0];
    const doc = await driver.get({ did });
    if (url.includes('#')) {
      const vm = (doc.verificationMethod || []).find(m => m.id === url);
      if (vm) return { contextUrl: null, documentUrl: url, document: { '@context': doc['@context'], ...vm } };
    }
    return { contextUrl: null, documentUrl: url, document: doc };
  }
  throw new Error('no loader for ' + url);
};
async function theirs(doc) {
  const dataset = await jsonld.toRDF(doc, { documentLoader, safe: true, base: null, rdfDirection: 'i18n-datatype', produceGeneralizedRdf: false });
  return rdfCanonize.canonize(dataset, { algorithm: 'RDFC-1.0', format: 'application/n-quads' });
}

console.log('\nRDFC-1.0 canonicalisation, checked against jsonld.js + rdf-canonize');
{
  const doc = { ...B.credential }; delete doc.proof;
  const opts = { '@context': B.credential['@context'], ...B.credential.proof }; delete opts.proofValue;
  const d = await theirs(doc), p = await theirs(opts);
  check('the document canonicalises identically', d === B.canonicalDoc, d === B.canonicalDoc ? `${d.split('\n').length - 1} quads, identical` : 'theirs:\n' + d + '\nbyline:\n' + B.canonicalDoc);
  check('the proof options canonicalise identically', p === B.canonicalProof, p === B.canonicalProof ? `${p.split('\n').length - 1} quads, identical` : 'theirs:\n' + p);
}

console.log('\necdsa-rdfc-2019 proof, verified by @digitalbazaar/vc');
{
  const suite = new DataIntegrityProof({ cryptosuite: ecdsaRdfc2019 });
  /* the proof is what is under test; the status list is Byline's own urn, so
     revocation is answered here rather than fetched */
  const checkStatus = async () => ({ verified: true });
  const r = await vcjs.verifyCredential({ credential: B.credential, suite, documentLoader, checkStatus });
  check('the reference verifier accepts the credential', r.verified === true, r.verified ? 'verified from the did:key alone' : JSON.stringify(r.error?.errors?.map(e => e.message) || r.error?.message || r, null, 1).slice(0, 600));
  const tampered = JSON.parse(JSON.stringify(B.credential)); tampered.credentialSubject.scope.push('delegate');
  const t = await vcjs.verifyCredential({ credential: tampered, suite, documentLoader, checkStatus });
  check('and refuses a claim added after signing', t.verified === false);
  const reordered = JSON.parse(JSON.stringify(B.credential)); reordered.credentialSubject.scope.reverse();
  const o = await vcjs.verifyCredential({ credential: reordered, suite, documentLoader, checkStatus });
  check('but not a reordered set — the graph is the same', o.verified === true, o.verified ? '' : JSON.stringify(o.error?.errors?.map(e => e.message)));
}

if (process.argv.includes('--issue')) {
  console.log('\nissuing one with the reference stack, for Byline to verify');
  const key = await EcdsaMultikey.generate({ curve: 'P-256' });
  const did = 'did:key:' + key.publicKeyMultibase;
  key.id = did + '#' + key.publicKeyMultibase; key.controller = did;
  const suite = new DataIntegrityProof({ signer: key.signer(), cryptosuite: ecdsaRdfc2019 });
  const credential = {
    '@context': ['https://www.w3.org/ns/credentials/v2', 'https://www.w3.org/ns/credentials/undefined-terms/v2'],
    type: ['VerifiableCredential', 'BylineDelegationCredential'],
    issuer: did, validFrom: '2026-09-06T00:00:00Z', validUntil: '2036-09-06T00:00:00Z',
    credentialSubject: { id: B.holderDid, name: 'Nib', authorisedBy: did, authorisedByName: 'The reference stack', scope: ['desk:read'], audience: 'urn:byline:masthead:elsewhere', parentCredential: null },
  };
  const signed = await vcjs.issue({ credential, suite, documentLoader });
  const back = await vcjs.verifyCredential({ credential: signed, suite: new DataIntegrityProof({ cryptosuite: ecdsaRdfc2019 }), documentLoader });
  check('the reference stack verifies its own credential', back.verified === true);
  writeFileSync(new URL('./byline-rdfc-in.json', import.meta.url), JSON.stringify({ credential: signed, issuerDid: did }, null, 1));
  console.log('  wrote byline-rdfc-in.json');
}

console.log(fails ? `\n${fails} FAILED` : '\nAll pass.');
process.exitCode = fails ? 1 : 0;
