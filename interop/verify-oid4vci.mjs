/* An OpenID4VCI exchange Byline carried out with itself — offer, token,
   proof, credential — handed to @openid4vc/openid4vci and @openid4vc/oauth2
   (the OpenWallet Foundation's implementation, no knowledge of Byline) to
   see whether they would have taken part. The library's own fetch is routed
   to the fixture, so it reads Byline's metadata, sends its own token request
   and credential request, and parses Byline's answers.

     node interop/verify-oid4vci.mjs
*/
import { readFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { base58btc } from 'multiformats/bases/base58';
import * as jose from 'jose';
import { Openid4vciClient, Openid4vciIssuer, zCredentialIssuerMetadataSchema } from '@openid4vc/openid4vci';
import { Oauth2Client, Oauth2AuthorizationServer } from '@openid4vc/oauth2';

const SRC = process.env.BYLINE_FIXTURE || new URL('./byline-oid4vci.json', import.meta.url);
const B = JSON.parse(readFileSync(SRC, 'utf8'));
let fails = 0;
const check = (name, pass, detail) => { console.log(`${pass ? '  PASS' : '  FAIL'}  ${name}${detail ? '\n        ' + detail : ''}`); if (!pass) fails++; };
const tryCheck = async (name, fn) => { try { const d = await fn(); check(name, d !== false, typeof d === 'string' ? d : undefined); } catch (e) { check(name, false, 'threw: ' + (e && e.message)); } };

function jwkFromDidKey(did) {
  const raw = base58btc.decode(String(did).split('#')[0].replace('did:key:', ''));
  if (raw[0] !== 0x80 || raw[1] !== 0x24) throw new Error('not a p256-pub did:key');
  const spki = Buffer.concat([Buffer.from('3039301306072a8648ce3d020106082a8648ce3d030107032200', 'hex'), Buffer.from(raw.slice(2))]);
  const { createPublicKey } = require('node:crypto');
  return createPublicKey({ key: spki, format: 'der', type: 'spki' }).export({ format: 'jwk' });
}
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

/* every request the library makes is answered from the fixture, and recorded */
const sent = [];
const base = B.issuerMetadata.credential_issuer;
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const fetchStub = async (url, init) => {
  const u = String(url), method = (init && init.method) || 'GET';
  const body = init && init.body ? (typeof init.body === 'string' ? init.body : init.body.toString()) : null;
  sent.push({ method, url: u, body });
  if (u.includes('/.well-known/openid-credential-issuer')) return json(200, B.issuerMetadata);
  if (u.includes('/.well-known/oauth-authorization-server')) return json(200, B.authorizationServerMetadata);
  if (u.includes('/.well-known/openid-configuration')) return json(404, { error: 'not_found' });
  if (u === base + '/token') return json(200, B.tokenResponse);
  if (u === base + '/credential') return json(200, B.credentialResponse);
  if (u === base + '/nonce') return json(200, { c_nonce: B.tokenResponse.c_nonce, c_nonce_expires_in: 300 });
  return json(404, { error: 'not_found', where: u });
};
const callbacks = {
  fetch: fetchStub,
  hash: (data, alg) => createHash(alg.replace('-', '').toLowerCase()).update(data).digest(),
  generateRandom: n => randomBytes(n),
  signJwt: async (signer, { header, payload }) => {
    const { privateKey, publicKey } = await jose.generateKeyPair('ES256');
    const jwt = await new jose.SignJWT(payload).setProtectedHeader(header).sign(privateKey);
    return { jwt, signerJwk: await jose.exportJWK(publicKey) };
  },
  verifyJwt: async (signer, { header, payload, compact }) => {
    try {
      const did = signer.method === 'did' ? signer.didUrl : (header.kid || '');
      const jwk = signer.method === 'jwk' ? signer.publicJwk : jwkFromDidKey(did);
      await jose.compactVerify(compact, await jose.importJWK(jwk, 'ES256'));
      return { verified: true, signerJwk: jwk };
    } catch (e) { return { verified: false }; }
  },
  clientAuthentication: () => { },
};

console.log('\nthe offer, read by the wallet library');
const client = new Openid4vciClient({ callbacks });
let offer = null;
await tryCheck('resolveCredentialOffer accepts the offer link', async () => {
  offer = await client.resolveCredentialOffer(B.offerUrl);
  const g = offer.grants['urn:ietf:params:oauth:grant-type:pre-authorized_code'];
  return !!g && g['pre-authorized_code'] === B.offer.grants['urn:ietf:params:oauth:grant-type:pre-authorized_code']['pre-authorized_code'] && `issuer ${offer.credential_issuer.slice(0, 40)}…, configurations ${offer.credential_configuration_ids.join(',')}`;
});

console.log('\nissuer metadata, fetched and validated by the library');
let issuerMetadata = null;
await tryCheck('the metadata passes the library\'s schema', async () => { zCredentialIssuerMetadataSchema.parse(B.issuerMetadata); return true; });
await tryCheck('resolveIssuerMetadata reads both well-known documents', async () => {
  issuerMetadata = await client.resolveIssuerMetadata(offer.credential_issuer);
  const cfg = issuerMetadata.knownCredentialConfigurations['byline-delegation'];
  return !!cfg && cfg.format === 'ldp_vc' && issuerMetadata.authorizationServers.length === 1 && `draft ${issuerMetadata.originalDraftVersion}, ${Object.keys(issuerMetadata.knownCredentialConfigurations).length} configuration(s), format ${cfg.format}`;
});

console.log('\nthe token step');
let accessToken = null;
await tryCheck('the library\'s own token request matches Byline\'s, and Byline\'s token response is accepted', async () => {
  const oauth = new Oauth2Client({ callbacks });
  const r = await oauth.retrievePreAuthorizedCodeAccessToken({ authorizationServerMetadata: issuerMetadata.authorizationServers[0], preAuthorizedCode: B.offer.grants['urn:ietf:params:oauth:grant-type:pre-authorized_code']['pre-authorized_code'] });
  accessToken = r.accessTokenResponse.access_token;
  const posted = sent.find(s => s.url === base + '/token');
  const theirs = new URLSearchParams(posted.body), mine = new URLSearchParams(B.tokenRequest);
  const same = theirs.get('grant_type') === mine.get('grant_type') && theirs.get('pre-authorized_code') === mine.get('pre-authorized_code');
  return same && accessToken === B.tokenResponse.access_token && `grant ${theirs.get('grant_type')}, token ${accessToken.slice(0, 8)}…, c_nonce ${String(r.accessTokenResponse.c_nonce).slice(0, 8)}…`;
});
await tryCheck('the authorization-server library parses Byline\'s token request as the pre-authorized grant', async () => {
  const as = new Oauth2AuthorizationServer({ callbacks });
  const parsed = as.parseAccessTokenRequest({
    request: { method: 'POST', url: B.authorizationServerMetadata.token_endpoint, headers: new Headers({ 'content-type': 'application/x-www-form-urlencoded' }) },
    accessTokenRequest: Object.fromEntries(new URLSearchParams(B.tokenRequest)),
    authorizationServerMetadata: B.authorizationServerMetadata });
  return parsed.grant.grantType === 'urn:ietf:params:oauth:grant-type:pre-authorized_code' && `code ${String(parsed.grant.preAuthorizedCode).slice(0, 8)}…`;
});

console.log('\nthe credential request and its proof, read by the issuer library');
const issuer = new Openid4vciIssuer({ callbacks });
await tryCheck('parseCredentialRequest recognises the configuration and the JWT proof', async () => {
  const p = issuer.parseCredentialRequest({ issuerMetadata, credentialRequest: B.credentialRequest });
  return !!p.proofs && !!p.proofs.jwt && p.proofs.jwt.length === 1 && (p.credentialConfigurationId === 'byline-delegation' || !!p.format) && `proofs.jwt × ${p.proofs.jwt.length}`;
});
await tryCheck('verifyCredentialRequestJwtProof accepts Byline\'s proof for this issuer and nonce', async () => {
  const v = await issuer.verifyCredentialRequestJwtProof({ issuerMetadata, jwt: B.credentialRequest.proofs.jwt[0], expectedNonce: B.tokenResponse.c_nonce, now: new Date(B.tokenResponse.issued_at || Date.now()) });
  const did = (v.signer && (v.signer.didUrl || '')).split('#')[0];
  return did === B.holderDid && `signed by ${did.slice(0, 30)}…, typ ${v.header.typ}`;
});
await tryCheck('and refuses it against a different nonce', async () => {
  try { await issuer.verifyCredentialRequestJwtProof({ issuerMetadata, jwt: B.credentialRequest.proofs.jwt[0], expectedNonce: 'not-the-nonce' }); return false; }
  catch (e) { return 'refused: ' + e.message.slice(0, 80); }
});

console.log('\nthe credential response, retrieved and parsed by the wallet library');
await tryCheck('retrieveCredentials sends the proof and reads Byline\'s credential back', async () => {
  const r = await client.retrieveCredentials({ issuerMetadata, accessToken, credentialConfigurationId: 'byline-delegation', proofs: { jwt: B.credentialRequest.proofs.jwt } });
  const c = r.credentialResponse.credentials?.[0]?.credential || r.credentialResponse.credential;
  const posted = sent.filter(s => s.url === base + '/credential').pop();
  const body = JSON.parse(posted.body);
  return !!c && [].concat(c.type).includes('BylineDelegationCredential') && c.credentialSubject.id === B.holderDid && body.credential_configuration_id === 'byline-delegation' && `bound to ${c.credentialSubject.id.slice(0, 30)}…, scope ${JSON.stringify(c.credentialSubject.scope)}`;
});

console.log(fails ? `\n${fails} FAILED` : '\nAll pass.');
process.exitCode = fails ? 1 : 0;
