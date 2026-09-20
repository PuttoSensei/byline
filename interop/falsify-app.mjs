/* Break the product on purpose, so the in-file suite has to prove it can see it.
   ============================================================================
   Ninety-four tests, all green. The interop harnesses were all green too, and
   two of those turned out to be passing whatever happened. This does the same
   exercise to the app: remove one load-bearing guard at a time, and require the
   test that claims to catch it to go red.

   Each mutant is a whole copy of byline.html written to _mutants/. The original
   is never touched. A mutation whose needle is not unique in the source is a
   hard error rather than a silent mis-edit — the slice that matches an earlier
   function is exactly how this kind of script lies. */
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, '..', 'byline.html');
const OUT = join(here, '..', '_mutants');
const src = readFileSync(SRC, 'utf8');

/* group: which slice of the suite to run (?only=)
   expect: a substring of the test name that MUST go red */
const MUTATIONS = [
  { id: 'chain-unlinked', group: 'The record,Anchoring',
    what: 'the hash chain stops including the previous link',
    find: "digest('chain:' + (e.prev || 'genesis') + '|'",
    to: "digest('chain:' + ('genesis') + '|'" },

  { id: 'vc-signature-ignored', group: 'Credentials,Delegation,Presentation,Interop',
    what: 'a credential proof that does not match is accepted anyway',
    find: "if (!ok) return { ok: false, why: 'the proof does not match the credential' };",
    to: "if (!ok) { /* mutated */ }" },

  { id: 'scope-escalation-allowed', group: 'Delegation',
    what: 'a correspondent may claim authority it was never given',
    find: "if (over.length) return { ok: false, why: 'it claims authority never granted to it: ' + over.join(', ') };",
    to: "if (false) { }" },

  { id: 'child-may-outlive-parent', group: 'Delegation',
    what: 'a sub-delegation may outlive the authority it came from',
    find: "if (parent.validUntil && vc.validUntil && Date.parse(vc.validUntil) > Date.parse(parent.validUntil))",
    to: "if (false && parent.validUntil && vc.validUntil && Date.parse(vc.validUntil) > Date.parse(parent.validUntil))" },

  { id: 'agent-roots-itself', group: 'Delegation',
    what: 'a correspondent may be the root of its own authority',
    find: "if (root.type === 'agent') return { ok: false, why: 'a correspondent cannot be the root of its own authority' };",
    to: "if (false) { }" },

  { id: 'revocation-ignored', group: 'Delegation,Presentation,OpenID4VP,Trust',
    what: 'a withdrawn credential is treated as live',
    find: "const slRevoked = i => statusList().revoked.indexOf(+i) >= 0;",
    to: "const slRevoked = i => false;" },

  { id: 'expiry-ignored', group: 'Delegation,Trust',
    what: 'an expired credential still verifies',
    /* this condition appears in verifyVC and again in verifyJwtVc; the return
       line is what tells them apart */
    find: "if (vc.validUntil && Date.parse(vc.validUntil) < now())\n      return { ok: false, why: 'it expired on ' + new Date(vc.validUntil).toLocaleDateString() };",
    to: "if (false) { }" },

  { id: 'stolen-credential-presentable', group: 'Presentation',
    what: 'anyone may present a credential issued to someone else',
    find: "if (subj && subj !== holder.did)\n    throw new Error('this credential was issued to someone else — ' + String(subj).slice(0, 30) + '…');",
    to: "if (false) { }" },

  { id: 'replay-allowed', group: 'Presentation,OpenID4VP',
    what: 'a presentation answering a different challenge is accepted',
    find: "if (expectChallenge != null && vp.proof.challenge !== expectChallenge)",
    to: "if (false && expectChallenge != null && vp.proof.challenge !== expectChallenge)" },

  { id: 'wrong-verifier-allowed', group: 'Presentation,OpenID4VP',
    what: 'a presentation made for another verifier is accepted',
    find: "if (expectDomain != null && vp.proof.domain !== expectDomain)",
    to: "if (false && expectDomain != null && vp.proof.domain !== expectDomain)" },

  { id: 'jcs-unsorted', group: 'Interop',
    what: 'canonicalisation stops sorting keys',
    find: "const keys = Object.keys(v).filter(k => v[k] !== undefined).sort();",
    to: "const keys = Object.keys(v).filter(k => v[k] !== undefined);" },

  { id: 'gate-ignores-credential', group: 'Delegation',
    what: 'the filing gate reads the card instead of the credential',
    find: "const pol = eff.scope.indexOf('desk:file') >= 0 ? 'always_allow'\n            : eff.scope.indexOf('desk:propose') >= 0 ? 'always_ask' : 'read_only';",
    to: "const pol = policyOf(agent);" },

  { id: 'oid4vp-impersonation', group: 'OpenID4VP',
    what: 'a request may be signed by a key other than the one client_id names',
    find: "if (String(r.header.kid).split('#')[0] !== claimed)",
    to: "if (false && String(r.header.kid).split('#')[0] !== claimed)" },

  { id: 'dcql-ignores-type', group: 'OpenID4VP',
    what: 'DCQL stops checking the credential type',
    find: "if (alts && !alts.some(set => [].concat(set).every(t => types.indexOf(t) >= 0)))",
    to: "if (false)" },

  { id: 'jwt-signature-ignored', group: 'Formats',
    what: 'a JWT with a bad signature is accepted',
    find: "if (!ok) return { ok: false, why: 'the signature does not match' };",
    to: "if (!ok) { /* mutated */ }" },

  { id: 'sd-smuggling-allowed', group: 'Formats',
    what: 'a disclosure the issuer never committed to is accepted',
    find: "if (unmatched.length) return { ok: false, why: 'a disclosed claim was not one this credential committed to — it has been added after signing' };",
    to: "if (false) { }" },

  { id: 'slack-housekeeping-imported', group: 'Newsroom',
    what: "Slack's own bookkeeping is imported as things people said",
    find: "if (r.subtype && HOUSEKEEPING.test(r.subtype)) {",
    to: "if (false) {" },

  /* ---- round two: the guards the first eighteen never touched ---- */
  { id: 'record-hash-unchecked', group: 'The record',
    what: 'an entry whose contents no longer match its hash is accepted',
    find: "if (!e.redacted && e.dataHash && e.dataHash !== dataHashOf(e.data, e.v))",
    to: "if (false)" },

  { id: 'record-link-unchecked', group: 'The record',
    what: 'a missing or reordered entry goes unnoticed by the walk',
    find: "if (e.prev !== prev) return { ok: false, at: i, of: chrono.length, why: 'an entry is missing or out of order', kind: e.kind, legacy };",
    to: "if (false) { }" },

  { id: 'record-chain-unchecked', group: 'The record',
    what: 'an entry altered after filing still walks clean',
    find: "if (chainOf(e) !== e.chain) return { ok: false, at: i, of: chrono.length, why: 'an entry was altered after it was filed', kind: e.kind, legacy };",
    to: "if (false) { }" },

  { id: 'seal-never-verified', group: 'The record',
    what: 'every seal is reported as valid without checking it',
    find: `    if (await SUBTLE.verify(ECSIG, await _pub(a), sig, body)) return true;
  } catch (e) { return false; }`,
    to: `    return true;
  } catch (e) { return false; }` },

  { id: 'rotation-breaks-old-seals', group: 'The record',
    what: 'a seal is checked against the current key only, so rotating reports every earlier seal as tampering',
    find: `    if (ev.ts > r.until) continue;
    try {
      const k = await SUBTLE.importKey('jwk', r.pubJwk, ECDSA, false, ['verify']);
      if (await SUBTLE.verify(ECSIG, k, sig, body)) return true;`,
    to: `    continue;
    try {
      const k = await SUBTLE.importKey('jwk', r.pubJwk, ECDSA, false, ['verify']);
      if (await SUBTLE.verify(ECSIG, k, sig, body)) return true;` },

  { id: 'retired-key-seals-forever', group: 'The record',
    what: 'a retired key may seal entries dated after it was handed over',
    find: `    if (ev.ts > r.until) continue;
    try {
      const k = await SUBTLE.importKey('jwk', r.pubJwk, ECDSA, false, ['verify']);
      if (await SUBTLE.verify(ECSIG, k, sig, body)) return true;`,
    to: `    try {
      const k = await SUBTLE.importKey('jwk', r.pubJwk, ECDSA, false, ['verify']);
      if (await SUBTLE.verify(ECSIG, k, sig, body)) return true;` },

  { id: 'redaction-keeps-data', group: 'The record',
    what: 'redacting an entry leaves its contents in place',
    find: "ev.data = {}; ev.redacted = { at: now(), by: S.meId };",
    to: "ev.redacted = { at: now(), by: S.meId };" },

  { id: 'anchor-truncation-ignored', group: 'Anchoring',
    what: 'a record shorter than its anchor witnessed passes',
    find: "if (behind < a.count) return { ok: false, why: `the record held ${a.count} entries when anchored and now holds ${behind} up to that point — ${a.count - behind} are missing` };",
    to: "if (false) { }" },

  { id: 'anchor-head-ignored', group: 'Anchoring',
    what: 'an anchored entry that has vanished from the record passes',
    /* the guard grew a branch for anchors older than the bounded tail, and the
       needle went stale with it — three of these sat unmatched, which meant the
       generator exited 1 and nobody could tell a new bad needle from an old one */
    find: "if (at < 0) {",
    to: "if (false) {" },

  { id: 'merge-duplicates-lines', group: 'Multiplayer,Peers',
    what: 'merging two copies of a desk duplicates every shared line',
    find: "a.concat(b).forEach(m => { if (!seen.has(m.id)) { seen.add(m.id); out.push(m); } });",
    to: "a.concat(b).forEach(m => { out.push(m); });" },

  { id: 'pull-clobbers-busy', group: 'Multiplayer',
    what: 'a sync from another window drops the in-flight run flag',
    find: "if (was) { const busy = was.busy; Object.assign(was, fresh.people[id]); if (busy) was.busy = busy; people[id] = was; }",
    to: "if (was) { Object.assign(was, fresh.people[id]); people[id] = was; }" },

  { id: 'reader-can-release', group: 'Permissions',
    what: 'anyone may release held copy, whatever their role',
    find: "function releaseProposal(id) {\n  if (!can('approve')) return refuse('approve copy');",
    to: "function releaseProposal(id) {" },

  { id: 'foreign-status-list-governs', group: 'Interop',
    what: "another masthead's withdrawal list revokes our credentials",
    find: "if (isOwnList(cs.statusListCredential)) {",
    to: "if (true) {" },

  { id: 'holder-mismatch-ignored', group: 'Presentation',
    what: 'a presentation naming one holder and signed by another is accepted',
    find: "if (vp.holder && vp.holder !== holderDid) return { ok: false, why: 'it names one holder and is signed by another' };",
    to: "if (false) { }" },

  { id: 'untrusted-root-accepted', group: 'Trust',
    what: 'a chain rooted in a stranger verifies without anyone saying so',
    find: "const trusted = trustedRoots().find(r => r.did === issuer);",
    to: "const trusted = { did: issuer, name: 'a stranger' };" },

  /* The forgery byline-core's interop/byline-issuer-forgery.mjs proved: the
     proof is checked against verificationMethod, authority is read off
     `issuer`, and for twenty-one passes nothing made them the same. */
  { id: 'issuer-not-bound-to-signer', group: 'Delegation,Peers',
    what: 'a credential may name one issuer and be signed by another — a stranger roots a chain in you',
    find: "if (named !== null && named !== did) return { ok: false, why: NOT_THE_ISSUER };",
    to: "if (false) { }" },

  { id: 'peer-sets-authority', group: 'Peers',
    what: 'a peer may take a credential off a correspondent whose key is held here, and turn its card up',
    find: "if (heldHere(was)) AUTHORITY_FIELDS.forEach(k => delete t[k]);",
    to: "" },

  { id: 'jwt-issuer-not-bound-to-signer', group: 'Delegation',
    what: 'the same, inside a JOSE envelope',
    find: "if (issuerOf(vc) !== null && issuerOf(vc) !== String(r.header.kid).split('#')[0]) return { ok: false, why: NOT_THE_ISSUER };",
    to: "if (false) { }" },

  { id: 'issuerless-authority-accepted', group: 'Delegation',
    what: 'a delegation that names no issuer escapes being held to one',
    find: "if (!issuer) return { ok: false, why: 'it does not say who issued it' };",
    to: "if (false) { }" },

  { id: 'revoked-key-still-signs', group: 'Identity',
    what: 'copy filed after a key was revoked still verifies',
    find: "if (isRevoked(a, m.ts)) return false;",
    to: "if (false) return false;" },

  { id: 'keys-left-in-clear', group: 'Identity',
    what: 'locking the masthead encrypts the keys but leaves the plaintext beside them',
    find: `p.enc = await wrapJwk(p.jwk);
    delete p.jwk;`,
    to: "p.enc = await wrapJwk(p.jwk);" },

  { id: 'did-key-unframed', group: 'Identity,Interop,Credentials',
    what: 'the multicodec header is no longer written into a did:key',
    find: "framed[0] = 0x80; framed[1] = 0x24;",
    to: "framed[0] = 0x81; framed[1] = 0x24;" },

  /* ---- the v2 record, the audience, the inflation ceiling ---- */
  { id: 'record-still-written-v1', group: 'The record',
    what: 'new entries are written in the legacy 96-bit format',
    find: "  const ev = { v: 2, id: uid('ev'), kind,",
    to: "  const ev = { id: uid('ev'), kind," },

  { id: 'v2-numbering-unchecked', group: 'The record',
    what: 'a v2 record with a number skipped walks clean as long as its hashes agree',
    find: "if (isV2(before) && e.seq !== before.seq + 1) return",
    to: "if (false) return" },

  { id: 'legacy-after-v2-accepted', group: 'The record',
    what: 'a legacy entry may follow a v2 one, so an editor can go back to the weak hash',
    find: "      if (isV2(before)) return { ok: false, at: i, of: chrono.length, why: 'a legacy entry follows",
    to: "      if (false) return { ok: false, at: i, of: chrono.length, why: 'a legacy entry follows" },

  { id: 'unknown-record-format-read-as-legacy', group: 'The record',
    what: 'an entry claiming a format this build has never heard of is walked as if it were legacy',
    find: "if (e.v !== undefined && e.v !== 2) return",
    to: "if (false) return" },

  { id: 'v2-seal-by-any-key', group: 'The record',
    what: 'a v2 seal verifies under whatever did the entry names, whoever the page says filed it',
    find: "    if (!theirs) return false;",
    to: "" },

  { id: 'v2-seal-accepts-line-signature', group: 'The record',
    what: 'a v2 seal is checked over the same bytes a filed line is signed over, so one can be replayed as the other',
    find: "const sealBodyV2 = ev => encU(SEAL_V2 + '\\n' + jcs(ev.chain));",
    to: "const sealBodyV2 = ev => encU(signBody({ id: ev.chain, channelId: '', authorId: ev.actorId, text: ev.chain, kind: 'seal', ts: ev.ts }));" },

  { id: 'revoked-key-still-seals', group: 'The record',
    what: 'a key seals entries dated after it was revoked',
    find: "  if (isRevoked(a, ev.ts)) return false;",
    to: "" },

  { id: 'sha256-wrong-on-a-boundary', group: 'The record',
    what: 'the synchronous SHA-256 pads one block short when the length lands on a boundary',
    find: "n = ((l + 8) >> 6) + 1;",
    to: "n = ((l + 7) >> 6) + 1;" },

  { id: 'audience-grants-anywhere', group: 'Delegation',
    what: 'a delegation issued for another masthead grants authority on this one',
    find: "    if (v.ok && !v.here) return { scope: [], from: 'broken',",
    to: "    if (false) return { scope: [], from: 'broken'," },

  { id: 'audience-checked-at-the-leaf-only', group: 'Delegation',
    what: 'a parent made for somewhere else is brought here by hanging a local child beneath it',
    find: "audience, here: here && up.here };",
    to: "audience, here };" },

  { id: 'audience-follows-the-title', group: 'Delegation',
    what: 'the accepted audiences are recomputed from the masthead title, which a peer can change',
    find: "  if (!Array.isArray(w.audiences) || !w.audiences.length || w.audiences.some(x => typeof x !== 'string')) {",
    to: "  if (true) {" },

  { id: 'status-list-inflates-without-limit', group: 'Withdrawal',
    what: 'a gzipped withdrawal list is inflated to whatever size it claims',
    find: "      if (size > (SL_MAX_INDEX >> 3)) {",
    to: "      if (false) {" },
];

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

/* A group name that does not exist in the suite would produce a run of zero
   tests — which reports zero failures and looks like the mutation survived
   nothing, or worse, gets read as a pass. Refuse those up front. */
/* group names can contain spaces — 'The record' is one, and a regex that
   only matched \w silently dropped it, which sent a mutation at three groups
   that had nothing to do with it and made a mis-aim look like a survivor */
const GROUPS = new Set([...src.matchAll(/await t\('([^']+)',/g)].map(m => m[1]));
const manifest = [];
let bad = 0;
for (const m of MUTATIONS) {
  const unknown = m.group.split(',').map(s => s.trim()).filter(g => !GROUPS.has(g));
  if (unknown.length) {
    console.log(`  BAD GROUP   ${m.id} — no test group named ${unknown.join(', ')}`);
    bad++; continue;
  }
  const n = src.split(m.find).length - 1;
  if (n !== 1) {
    console.log(`  BAD NEEDLE  ${m.id} — matches ${n} times, refusing to guess`);
    bad++; continue;
  }
  const file = `byline--${m.id}.html`;
  writeFileSync(join(OUT, file), src.replace(m.find, m.to));
  manifest.push({ id: m.id, what: m.what, group: m.group, file });
}
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`\n${manifest.length} mutants written to _mutants/, ${bad} needles rejected.`);
if (bad) process.exit(1);
