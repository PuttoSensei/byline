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
    find: "if (!e.redacted && e.dataHash && e.dataHash !== dataHashOf(e.data))",
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
    find: "    return await SUBTLE.verify(ECSIG, await _pub(a), unHex(ev.seal),",
    to: "    return true; await SUBTLE.verify(ECSIG, await _pub(a), unHex(ev.seal)," },

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
    find: "if (at < 0) return { ok: false, why: 'the anchored entry is no longer in the record — entries have been removed from the end or rewritten' };",
    to: "if (false) { }" },

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
    find: "if (cs && cs.statusListIndex != null && cs.statusListCredential === STATUS_LIST_URL && slRevoked(cs.statusListIndex))",
    to: "if (cs && cs.statusListIndex != null && slRevoked(cs.statusListIndex))" },

  { id: 'holder-mismatch-ignored', group: 'Presentation',
    what: 'a presentation naming one holder and signed by another is accepted',
    find: "if (vp.holder && vp.holder !== holderDid) return { ok: false, why: 'it names one holder and is signed by another' };",
    to: "if (false) { }" },

  { id: 'untrusted-root-accepted', group: 'Trust',
    what: 'a chain rooted in a stranger verifies without anyone saying so',
    find: "const trusted = trustedRoots().find(r => r.did === vc.issuer);",
    to: "const trusted = { did: vc.issuer, name: 'a stranger' };" },

  { id: 'revoked-key-still-signs', group: 'Identity',
    what: 'copy filed after a key was revoked still verifies',
    find: "if (isRevoked(a, m.ts)) return false;",
    to: "if (false) return false;" },

  { id: 'keys-left-in-clear', group: 'Identity',
    what: 'locking the masthead encrypts the keys but leaves the plaintext beside them',
    find: "p.enc = { iv: toHex(iv), ct: toHex(ct) };\n    delete p.jwk;",
    to: "p.enc = { iv: toHex(iv), ct: toHex(ct) };" },

  { id: 'did-key-unframed', group: 'Identity,Interop,Credentials',
    what: 'the multicodec header is no longer written into a did:key',
    find: "framed[0] = 0x80; framed[1] = 0x24;",
    to: "framed[0] = 0x81; framed[1] = 0x24;" },
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
