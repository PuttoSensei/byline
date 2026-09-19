/* Does any of this actually check anything?
   ==========================================
   Forty-odd external checks across four harnesses, all green. Green means
   nothing until you know what would turn it red — and I already found one
   check in verify-wallet.mjs that was passing while testing nothing at all.

   So: break the evidence on purpose, one thing at a time, and require the
   check that claims to guard it to stop saying PASS. A mutation the harness
   fails to notice is a hollow check, named and reported.

   Nothing here touches the real fixtures. Each mutant is written to a temp
   directory and the harness is pointed at it with BYLINE_FIXTURE, so a crash
   mid-run cannot damage anything and there is no restore step to get wrong. */
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const here = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const load = f => JSON.parse(readFileSync(join(here, f), 'utf8'));
const clone = o => JSON.parse(JSON.stringify(o));
/* flip one character inside a base58/base64 blob without changing its length */
const nudge = s => {
  const i = Math.floor(s.length / 2);
  const c = s[i] === 'A' ? 'B' : s[i] === 'a' ? 'b' : s[i] === '1' ? '2' : 'A';
  return s.slice(0, i) + c + s.slice(i + 1);
};
const rewriteJwtPayload = (jwt, fn) => {
  const [h, b, s] = jwt.split('.');
  const p = JSON.parse(Buffer.from(b, 'base64url').toString());
  fn(p);
  return h + '.' + Buffer.from(JSON.stringify(p)).toString('base64url') + '.' + s;
};

/* ---- the mutations, each naming the check it must silence ---- */
const PLANS = [
  {
    script: 'verify.mjs', fixture: 'byline-credentials.json',
    mutations: [
      { name: 'canonical bytes drift by one space',
        silences: 'document canonicalises identically',
        apply: b => { b.bylineJcsDoc = b.bylineJcsDoc.replace('{"@context"', '{ "@context"'); } },
      { name: 'proof config canonical bytes altered',
        silences: 'proof config canonicalises identically',
        apply: b => { b.bylineJcsProof = b.bylineJcsProof.replace('"created"', '"Created"'); } },
      { name: 'one character of the signature flipped',
        silences: 'correspondent: node:crypto verifies it from the did:key alone',
        apply: b => { b.correspondent.proof.proofValue = nudge(b.correspondent.proof.proofValue); } },
      { name: 'a claim rewritten after signing',
        silences: 'correspondent: node:crypto verifies it from the did:key alone',
        apply: b => { b.correspondent.credentialSubject.role = 'editor-in-chief'; } },
      { name: 'the delegation credential altered',
        silences: 'delegation: node:crypto verifies it from the did:key alone',
        apply: b => { b.delegation.credentialSubject.scope = ['desk:read', 'desk:file', 'delegate', 'everything']; } },
      { name: 'the identifier is an Ed25519 did:key, not P-256',
        silences: 'framed with the p256-pub multicodec 0x1200',
        apply: b => {
          const ed = 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK';
          b.correspondent.proof.verificationMethod = ed + '#' + ed.replace('did:key:', '');
        } },
    ],
  },
  {
    script: 'verify-formats.mjs', fixture: 'byline-formats.json',
    mutations: [
      { name: 'the JWT payload rewritten',
        silences: 'jose accepts the signature',
        apply: b => { b.jwt = rewriteJwtPayload(b.jwt, p => { p.credentialSubject.role = 'editor-in-chief'; }); } },
      { name: 'a withheld claim left in the selective credential',
        silences: 'the withheld values are absent from the wire',
        apply: b => {
          const [jwt, ...rest] = b.sdCombined.split('~');
          b.sdCombined = rewriteJwtPayload(jwt, p => { p.credentialSubject.harness = 'Claude Code'; })
            + '~' + rest.join('~');
        } },
      { name: 'a disclosure that hashes to nothing the credential committed to',
        silences: 'each disclosure hashes to a committed digest',
        apply: b => { b.allDisclosures[2] = Buffer.from(JSON.stringify(['zSalt', 'role', 'chief'])).toString('base64url'); } },
      { name: 'the presentation signature flipped',
        silences: 'node:crypto verifies the holder’s signature',
        apply: b => { b.presentation.proof.proofValue = nudge(b.presentation.proof.proofValue); } },
      { name: 'the challenge changed after signing',
        silences: 'the challenge and domain are inside the signed proof',
        apply: b => { b.presentation.proof.challenge = 'zSomethingElseEntirely'; } },
      { name: 'the presentation signed for assertion, not authentication',
        silences: 'it is signed for authentication, not assertion',
        apply: b => { b.presentation.proof.proofPurpose = 'assertionMethod'; } },
      { name: 'the credential inside swapped for someone else’s subject',
        silences: 'and it was issued to the holder presenting it',
        apply: b => { b.presentation.verifiableCredential[0].credentialSubject.id = 'did:key:zSomeoneElse'; } },
    ],
  },
  {
    script: 'verify-oid4vp.mjs', fixture: 'byline-oid4vp.json',
    mutations: [
      { name: 'the request object signature flipped',
        silences: 'jose verifies the request signature',
        apply: b => { const p = b.requestJwt.split('.'); b.requestJwt = p[0] + '.' + p[1] + '.' + nudge(p[2]); } },
      { name: 'the request claims to be from someone else',
        silences: 'and the signing key is the one client_id names',
        apply: b => { b.requestJwt = rewriteJwtPayload(b.requestJwt, p => { p.client_id = 'decentralized_identifier:did:key:zAttacker'; }); } },
      { name: 'the request typed as an ordinary JWT',
        silences: 'typ is oauth-authz-req+jwt',
        apply: b => {
          const [h, rest1, rest2] = b.requestJwt.split('.');
          const head = JSON.parse(Buffer.from(h, 'base64url').toString());
          head.typ = 'JWT';
          b.requestJwt = Buffer.from(JSON.stringify(head)).toString('base64url') + '.' + rest1 + '.' + rest2;
        } },
      { name: 'the state altered in the response',
        silences: 'state is echoed back unchanged',
        apply: b => { b.formBody = b.formBody.replace(/&state=.*$/, '&state=zNotTheOneAsked'); } },
      { name: 'the vp_token keyed by the wrong query id',
        silences: 'vp_token is keyed by the DCQL query id',
        apply: b => { b.formBody = b.formBody.replace('%22byline_delegation%22', '%22something_else%22'); } },
      { name: 'the presentation bound to a different nonce',
        silences: 'challenge is the nonce from the request',
        apply: b => { b.formBody = b.formBody.replace(/%22challenge%22%3A%22[^%]+%22/, '%22challenge%22%3A%22zWrongNonce%22'); } },
      { name: 'the presentation bound to a different verifier',
        silences: 'domain is the whole Client Identifier, prefix included',
        apply: b => { b.formBody = b.formBody.replace(/%22domain%22%3A%22decentralized_identifier[^%]*(%3A[^%]*)*%22/, '%22domain%22%3A%22attacker%22'); } },
    ],
  },
  {
    script: 'verify-wallet.mjs', fixture: 'byline-oid4vp.json',
    mutations: [
      { name: 'the request has no client_id at all',
        silences: 'their validator accepts the request’s client_id',
        apply: b => { b.requestJwt = rewriteJwtPayload(b.requestJwt, p => { delete p.client_id; }); } },
      { name: 'an invented Client Identifier Prefix',
        silences: 'their schema recognises the Client Identifier Prefix',
        apply: b => { b.requestJwt = rewriteJwtPayload(b.requestJwt, p => { p.client_id = 'byline_special:did:key:zX'; }); } },
      { name: 'a credential format nobody defines',
        silences: 'their schema recognises the credential format we ask for',
        apply: b => { b.requestJwt = rewriteJwtPayload(b.requestJwt, p => { p.dcql_query.credentials[0].format = 'byline_vc'; }); } },
      { name: 'the response carries no vp_token',
        silences: 'their response schema accepts the shape',
        apply: b => { b.formBody = 'state=' + new URLSearchParams(b.formBody).get('state'); } },
      { name: 'the request uses Presentation Exchange, not DCQL',
        silences: 'their validator pairs the response with the request',
        apply: b => { b.requestJwt = rewriteJwtPayload(b.requestJwt, p => {
          delete p.dcql_query;
          p.presentation_definition = { id: 'pd', input_descriptors: [{ id: 'a' }] };
        }); } },
      { name: 'the vp_token is empty',
        silences: 'their DCQL reader finds the credential we sent',
        apply: b => { b.formBody = 'vp_token=' + encodeURIComponent('{}') + '&state=' + new URLSearchParams(b.formBody).get('state'); } },
      { name: 'the presented value is a bare string, not a presentation',
        silences: 'and reads it as a W3C presentation, not an opaque blob',
        apply: b => {
          const st = new URLSearchParams(b.formBody).get('state');
          b.formBody = 'vp_token=' + encodeURIComponent(JSON.stringify({ byline_delegation: ['not-a-presentation'] })) + '&state=' + st;
        } },
    ],
  },
];

const tmp = mkdtempSync(join(tmpdir(), 'byline-falsify-'));
const run = fixturePath => {
  const env = { ...process.env };
  if (fixturePath) env.BYLINE_FIXTURE = fixturePath; else delete env.BYLINE_FIXTURE;
  return script => {
    try {
      const out = execFileSync(process.execPath, [join(here, script)], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      return { code: 0, out };
    } catch (e) {
      return { code: e.status == null ? -1 : e.status, out: (e.stdout || '') + (e.stderr || '') };
    }
  };
};
const passes = out => (out.match(/^ {2}PASS {2}/gm) || []).length;
const passed = (out, name) => out.split('\n').some(l => l.startsWith('  PASS  ') && l.slice(8).trim() === name);

let hollow = [], missing = [], checked = 0;
console.log('\nFalsifying the interop harnesses\n' + '='.repeat(60));

for (const plan of PLANS) {
  console.log(`\n${plan.script}`);
  /* Baseline first. A harness that reports zero passes would "agree" with
     every mutation and certify everything for ever — so zero is a failure. */
  const base = run(null)(plan.script);
  if (base.code !== 0 || passes(base.out) === 0) {
    console.log(`  BASELINE BROKEN — exit ${base.code}, ${passes(base.out)} passes. Nothing below means anything.`);
    hollow.push({ script: plan.script, name: 'baseline', silences: '(whole harness)' });
    continue;
  }
  console.log(`  baseline: ${passes(base.out)} passing, exit 0`);

  for (const mut of plan.mutations) {
    checked++;
    /* the check must exist in the clean run, or we are guarding a ghost */
    if (!passed(base.out, mut.silences)) {
      console.log(`  ?  ${mut.name}\n     no check named "${mut.silences}" in the clean run`);
      missing.push({ script: plan.script, name: mut.name, silences: mut.silences });
      continue;
    }
    const b = clone(load(plan.fixture));
    mut.apply(b);
    const path = join(tmp, `${plan.script}-${checked}.json`);
    writeFileSync(path, JSON.stringify(b));
    const r = run(path)(plan.script);
    const stillPasses = passed(r.out, mut.silences);
    if (stillPasses) {
      console.log(`  SURVIVED  ${mut.name}\n            "${mut.silences}" still says PASS — that check is hollow`);
      hollow.push({ script: plan.script, name: mut.name, silences: mut.silences });
    } else {
      console.log(`  killed    ${mut.name}`);
    }
  }
}

rmSync(tmp, { recursive: true, force: true });
console.log('\n' + '='.repeat(60));
console.log(`${checked} mutations, ${hollow.length} survived, ${missing.length} had no matching check.`);
if (missing.length) {
  console.log('\nNo check by that name (the mutation list has drifted from the harness):');
  missing.forEach(m => console.log(`  ${m.script}: ${m.name} -> "${m.silences}"`));
}
if (hollow.length) {
  console.log('\nHOLLOW CHECKS — these pass whether or not the thing they name is true:');
  hollow.forEach(h => console.log(`  ${h.script}: "${h.silences}" survives "${h.name}"`));
} else {
  console.log('\nEvery mutation was caught. Each check has now been seen to fail.');
}
process.exit(hollow.length || missing.length ? 1 : 0);
