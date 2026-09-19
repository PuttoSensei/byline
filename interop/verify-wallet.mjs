/* The check that matters most and that Byline has never had: an OpenID4VP
   request and response produced here, read by somebody else's OpenID4VP
   implementation. Not a JOSE library confirming a signature is well-formed —
   a wallet/verifier library deciding whether this is a protocol message it
   would accept.

   @openid4vc/openid4vp is Animo's implementation, written against the same
   1.0 spec and with no knowledge of Byline whatsoever. If Byline's protocol
   layer is subtly its own invention, this is where that shows. */
import { readFileSync } from 'node:fs';
import * as oid from '@openid4vc/openid4vp';

const SRC = process.env.BYLINE_FIXTURE || new URL('./byline-oid4vp.json', import.meta.url);
const B = JSON.parse(readFileSync(SRC, 'utf8'));
let fails = 0;
const check = (name, pass, detail) => {
  console.log(`${pass ? '  PASS' : '  FAIL'}  ${name}${detail ? '\n        ' + detail : ''}`);
  if (!pass) fails++;
};
const show = e => (e && (e.message || String(e))).split('\n').slice(0, 6).join('\n        ');

const payload = JSON.parse(Buffer.from(B.requestJwt.split('.')[1], 'base64url').toString());
const url = 'openid4vp://authorize?client_id=' + encodeURIComponent(payload.client_id)
  + '&request=' + B.requestJwt;

console.log('\nByline’s Authorization Request, read by @openid4vc/openid4vp');

/* 1. does their parser recognise it as an OpenID4VP request at all? */
try {
  const parsed = oid.parseOpenid4vpAuthorizationRequest({ authorizationRequest: url });
  check('their parser accepts the request URL', true,
    'params: ' + Object.keys(parsed.params || parsed).join(', '));
  console.log('        ' + JSON.stringify(Object.keys(parsed)));
} catch (e) { check('their parser accepts the request URL', false, show(e)); }

/* 2. their request validator.
   Stated narrowly on purpose. Mutation testing showed this function checks the
   client_id and essentially nothing else: a request with no dcql_query, or with
   response_type "code", sails through it. An earlier version of this file
   called the check "their validator accepts the request payload" and listed
   four fields it does not look at — a green tick for three claims nobody had
   made. The structural checks that follow are the honest replacement. */
try {
  oid.validateOpenid4vpAuthorizationRequestPayload({ params: payload });
  check('their validator accepts the request’s client_id', true,
    'this function checks the Client Identifier; the schema checks below cover the rest');
} catch (e) { check('their validator accepts the request’s client_id', false, show(e)); }

/* 3. their own schemas, which do discriminate */
try {
  const r = oid.zClientIdPrefix.safeParse(payload.client_id.split(':')[0]);
  check('their schema recognises the Client Identifier Prefix', r.success,
    r.success ? payload.client_id.split(':')[0] : JSON.stringify(r.error.issues[0]).slice(0, 90));
} catch (e) { check('their schema recognises the Client Identifier Prefix', false, show(e)); }

try {
  const fmt = payload.dcql_query.credentials[0].format;
  const r = oid.zCredentialFormat.safeParse(fmt);
  check('their schema recognises the credential format we ask for', r.success,
    r.success ? fmt : JSON.stringify(r.error.issues[0]).slice(0, 90));
} catch (e) { check('their schema recognises the credential format we ask for', false, show(e)); }

/* 4. which version of the spec do they think this is? */
try {
  const ver = oid.parseAuthorizationRequestVersion({ params: payload });
  check('they identify it as OpenID4VP 1.0', ver === 101 || (ver && ver.version === 101),
    JSON.stringify(ver) + ' (101 is the 1.0 final marker)');
} catch (e) { check('they identify it as OpenID4VP 1.0', false, show(e)); }

console.log('\nByline’s Authorization Response, read by the same library');

const form = new URLSearchParams(B.formBody);
const responsePayload = { vp_token: JSON.parse(form.get('vp_token')), state: form.get('state') };

/* their own parser for a response payload, called the way it is declared */
let theirResponse = null;
try {
  theirResponse = oid.parseOpenid4VpAuthorizationResponsePayload(responsePayload);
  check('their parser accepts the response payload', true,
    'state ' + (theirResponse.state ? 'present' : 'absent') + ', vp_token is a '
      + (typeof theirResponse.vp_token === 'object' ? 'JSON object' : typeof theirResponse.vp_token));
} catch (e) { check('their parser accepts the response payload', false, show(e)); }

try {
  const r = oid.zOpenid4vpAuthorizationResponse.safeParse(responsePayload);
  check('their response schema accepts the shape', r.success,
    r.success ? 'vp_token + state' : JSON.stringify(r.error.issues[0]).slice(0, 100));
} catch (e) { check('their response schema accepts the shape', false, show(e)); }

try {
  const v = oid.validateOpenid4vpAuthorizationResponsePayload({
    authorizationRequestPayload: payload,
    authorizationResponsePayload: theirResponse || responsePayload,
  });
  check('their validator pairs the response with the request', v && v.type === 'dcql',
    'type ' + (v && v.type ? v.type : '(none reported)'));
} catch (e) { check('their validator pairs the response with the request', false, show(e)); }

/* The one that matters: their DCQL reader, given ONLY the vp_token. It takes
   the token directly — an earlier version of this file passed it an options
   object, which it happily treated as the token and echoed the keys back, so
   the check passed while testing nothing. */
try {
  const out = oid.parseDcqlVpToken(responsePayload.vp_token);
  const key = Object.keys(out)[0];
  const entries = out[key] || [];
  check('their DCQL reader finds the credential we sent', !!key && entries.length > 0,
    `query id "${key}", ${entries.length} presentation` + (entries.length === 1 ? '' : 's'));
  const first = entries[0] || {};
  check('and reads it as a W3C presentation, not an opaque blob',
    typeof first === 'object' && !!(first.presentation || first.vp || first.credential || first.encoded || first.type),
    'entry keys: ' + Object.keys(first).join(', '));
} catch (e) {
  check('their DCQL reader finds the credential we sent', false, show(e));
}

console.log(`\n${fails ? fails + ' FAILED' : 'All checks passed'} — read by an implementation that has never heard of Byline.\n`);
process.exit(fails ? 1 : 0);
