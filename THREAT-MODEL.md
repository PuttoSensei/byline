# What Byline protects against, and what it doesn't

Security products are usually described by what they defend. That half is easy
to write and easy to oversell. This document leads with the other half.

Byline is a prototype. Nothing here has been through an external audit. Read
the second section before trusting it with anything that matters.

---

## What it does not protect against

**Anyone with access to this browser profile.** Private keys live in
localStorage. Encrypting them at rest (Settings → Keys at rest) raises the bar
to a passphrase, or to a passkey — the wrapping key is then derived from a
secret only your authenticator produces, so nothing on disk opens the keys
without a verified touch. But the decrypted key is in memory the whole time the
tab is unlocked. A person at your unlocked machine, or a browser extension with
content script access, has your key. The passkey path has not yet met a real
authenticator; it is tested against a fake that honours the contract.

**Any script that runs on the page.** The file now carries a Content Security
Policy whose `script-src` is the SHA-256 of its own inline script and nothing
else: an injected or pasted script is refused by the browser. That closes the
common door, not the room. Inline styles are still allowed, an extension with
content-script access is not a script the page controls, and there is no
isolation between the UI and the key material — an unwrapped key is a
non-extractable object in memory, which stops it being read out, not being
used. If an attacker can execute JavaScript in this origin despite the policy,
they can sign as you. Byline's signatures prove *which key* signed — not that a
human meant it. On the hosted page the policy is ignored: the viewer wraps the
file in its own document, and a policy outside `<head>` is not honoured.

**Someone who never re-reads the withdrawal list.** Revocation flips a bit in a
`BitstringStatusList`. That only reaches a verifier who fetches the list again.
With a relay the list is hosted at an address, every withdrawal is pushed there,
and a verifier that fetches it honours it — and fails closed on a list it cannot
reach, cannot verify, or that was signed by the wrong key. Without a relay the
list is published by hand. Either way a verifier working from a cached copy sees
an old world for as long as it trusts the cache; Byline's own cache is a minute,
and the list itself expires in twenty-four hours.

**Losing a `did:key`.** The key *is* the name. Rotation now leaves a signed
handover — the old key names its successor, the successor signs its acceptance
inside it — so a verifier can follow a byline across keys. But that is a remedy
for age, not for compromise: whoever holds a stolen key can sign a handover to
a key of their own, and the honest handover and the thief's look the same. A
compromised key still means re-issuing every credential in the chain under a
new identifier and persuading everyone to trust it. `did:web` avoids the
renaming by putting the document at an address you control — and buys a web
server, a domain, and everyone who can modify either. The relay can host that
document; it cannot make anyone trust the address.

**Traffic analysis, and the fact of communication.** Peer connections are
encrypted by WebRTC (DTLS-SRTP), but who talks to whom, when, and how much is
not hidden from anyone watching the network. There is no metadata protection
and no onion routing.

**A model that lies.** Byline proves a correspondent's output was signed by a
particular key under a particular delegation. It says nothing about whether the
output is true. A signed hallucination is a signed hallucination.

**A malicious peer with your data.** Once you sync a masthead to another
machine, that machine has a full copy of the record. Nothing recalls it.
Delegation and revocation govern what a correspondent may *do* — not what a
person who already has your bytes may keep. What that copy no longer contains
is anyone's private key: see below.

**Handing a peer your signing key — fixed, and it was as bad as it sounds.**
Until this pass, connecting to a peer sent the workspace verbatim down the data
channel, and a person's private JWK lives in the workspace. So every signing key
in the masthead — yours and every correspondent's — crossed to the other
machine on connect. Holding your key, that peer could file lines as you which
verify, and the record could not tell. The dialogue said "the masthead itself
goes machine to machine", and no one reading that had reason to think their
byline was going with it. Nothing warned them, and nothing in the interface
would have shown it afterwards.

A snapshot now carries public material only — no `jwk`, `sec`, `enc`, `nextJwk`,
`nextEnc`, and no `key` (a `CryptoKey` serialised to `{}`, which made the far
side believe it held a key it did not). The lock that wraps keys at rest does not
travel either. Coming the other way the rule is the same and matters more: key
material in an incoming snapshot is discarded, your own identity is never
described by a peer's copy of it, and an identity this masthead holds the private
key for cannot be re-keyed by somebody else — a peer telling you your key has
changed is a peer arranging to sign as you. An identity you have not met is
learned public-only, which is all that verifying it ever needed.

The snapshot was not the only door. Every line filed while a peer is connected
goes out with its author attached, so the far side can attribute and verify it
without having synced first — and that was the person object, private key
included. One message was enough. It now sends the public person, and an author
arriving from a peer is installed public-only, so a stranger learned from a line
is someone this masthead can verify and cannot impersonate.

The cost is honest and small: `sec`, the toy digest scheme's secret, is also its
verifier, so a peer's legacy digest-signed lines now read as unverifiable rather
than verified. That asymmetry is the whole reason the real scheme exists.

**Markup through an identifier — fixed.** Text was escaped before it was
drawn; identifiers and colours went into attributes as they came, because this
file used to make them all. Once peers shared desks, lines and people, a peer
could choose an identifier that closed its attribute and wrote markup into the
page — eleven elements from one snapshot and one line, measured — and a reaction
was drawn with no escaping at all. The hash-only CSP stopped that markup from
running script. It did not stop it drawing a false verification chip, covering a
button, or adding a link. Identifiers, colours and reactions are now checked on
the way in (every snapshot, stored masthead and imported file passes through
`hydrate`; peer lines and reactions are checked where they arrive) and escaped
where they land.

**Who is on the other end of a peer connection — fixed, with a residual.** The
name a peer announces is whatever they typed, and a room code read aloud can be
answered by whoever hears it first; DTLS encrypts the channel to whoever that
was. Both screens now show an eight-digit code made from both ends' DTLS
fingerprints, and nothing of the masthead is sent or taken until the person
here confirms the codes match. A mismatch hangs up. The residual: someone in
the middle of *both* code exchanges could generate certificates until the two
codes agree, at about 10^8 tries a connection. That is real work, not
impossible work, and reading the codes aloud over a channel the attacker does
not also control is what makes it fail.

**Who may grant authority here — decided.** A person roots a chain of authority
only if this masthead holds their key or its owner has said so, in a flag that
never crosses to or from a peer. Before this, connecting to a peer quietly
widened who could authorise a correspondent to file here.

**The API key and relay token under the lock — fixed; the lock itself still
optional.** Both are wrapped with the private keys and live only in memory while
unlocked, and the lock is now offered when a masthead is made. It is still off
until someone turns it on, and whether Chromium shares one storage area across
`file://` pages is still untested. Both of those remain open.

**An import that said what it would do — fixed.** A masthead file now shows,
before it replaces anything, whose key you would be filing with, whether the
file's author holds it, and which model, relay and workflows it would bring.
Those come in only when ticked.

**Someone else's code, for the first time.** The bridge to Buzz signs with
secp256k1, which WebCrypto does not do, so byline.html now carries
`@noble/secp256k1` 3.2.0 (MIT). It is pinned by the SHA-256 of the file it came
from, wrapped so only what the bridge uses escapes, and checked against
BIP-340's vectors in the browser and against libsecp256k1 in
`interop/verify-nipoa.py`. Its author says plainly that this version has not
been independently audited (the v1 it rewrites was, by Cure53, in April 2021).
That is why it is checked rather than trusted. Updating it means re-vendoring,
re-hashing and re-running both checks. Its code runs inside the page, like
everything else here, so a flaw in it would be a flaw in this file.

**A NIP-OA tag cannot be withdrawn early.** NIP-OA has no revocation. An exported
tag is a reusable capability until its `created_at<` deadline, and withdrawing
the Byline delegation it came from does not reach it. Buzz ends an agent by
ending its owner's relay membership. The export says so, and keeps the deadline
at the delegation's own end date.

**A live model filed without asking — fixed.** When a correspondent's reply came
from a live model, it was posted directly: a withdrawn delegation, "reads only"
and "asks first" were never consulted. Live copy now passes the same gate as
scripted copy, and is held for release unless its owner chose "files directly"
for that correspondent. The residual is the choice itself: a correspondent told
to file directly will file whatever the model says, and a model reading a desk
can be steered by what is written on it.

**Opened from a file, in Chrome — measured, and the lock no longer optional
there.** Chrome gives every local HTML file one shared storage area: a page in
one folder read what a page in another had written. Firefox keeps them apart.
Any page opened from a file is now treated as shared — the lock is offered at
every launch, a sidebar warning stays until the keys are locked, and declining
is never remembered. A person can still say "not now" every time; what a page
cannot do is lock keys nobody unlocks.

**Revocation — fixed.** A revocation is a signed statement, by the key itself or
by someone who may grant authority here; a peer can pass one on and cannot make
one. The residual: the statement names its own time, so the key's holder, or a
root here, can date a revocation into the past — which is what a compromise
needs, and also how a signer could disown lines. It is signed, so who did it is
on the record.

**The relay — fixed.** It always needs a token for publishing and delivery,
making and printing one if none is set, and refuses a withdrawal list older than
the one it holds. Verifiers here have always refused an expired list. Rooms stay
open by design; the code comparison is what says who answered one.

**Where an issuer can send your browser — fixed, with a residual.** Withdrawal
lists and did:web documents are fetched over https only, never from a loopback,
private or link-local address unless it is your own relay. A page cannot resolve
names, so a public name that resolves to a private address is not caught here.

**The test link — fixed.** Results go only to the server that served the page,
or to this machine.

**The masthead file still holds every key, on purpose.** "Download masthead" is a
backup you can open on another machine, so it is the full state, keys included.
That makes it the one file here that must not be passed to a colleague, and it
now says so as it downloads. If you want to give someone the record without the
keys, that feature does not exist yet.

**An identifier that was not its key — fixed, five times over.** A `did:key` is
self-certifying: the public key is inside the name, so nobody has to be trusted
about which key it means. Byline did not always hold itself to that.

- The decoder rebuilt a point from an identifier without checking it lay on
  P-256, or that its x was below the field prime. WebCrypto refuses such a key
  on import, so nothing was ever verified against one — but key hashes and
  identity comparisons took it as real, and one key could answer to two
  identifiers.
- Checking a credential used the stored key of whichever person claimed the
  issuer's did, not the key inside the did. A record pairing somebody's
  `did:key` with another key — which the next two faults could each produce —
  made that other key's signatures verify as theirs.
- Importing a key file took the new key and kept the old identifier, so this
  masthead's own credentials verified here and failed everywhere else.
- A peer could introduce a person under somebody else's identifier.
- A peer could re-key a colleague this masthead already knows, add a key to
  their past (a retired key vouches for lines filed before it retired), leave
  one out to disown lines, or clear a revocation and make a stolen key good
  again.

Now an identifier is dropped wherever it does not match its key; a stored key
is used only when it matches the did it is filed under; an import derives the
identifier from the key and refuses a file whose public key is not its private
key's; and a peer's copy never moves a key this masthead holds for somebody.
Only a rotation both keys signed does that, followed hop by hop, dated by the
signed handover rather than by the peer's copy, and refused when the handover
is genuine but between two other keys.

(The two things this section once left as policy are now decided: who may
grant authority, below, and who may revoke a key — only the key itself, or
someone who may grant authority here, in a signed statement.)

**Everything else on the wire — fixed.** Removing private keys from the peer
snapshot left the rest of the state going across: the model API key, the relay
token, the wallet with every selective-disclosure claim in it, and the
workflows. The merge on the other side took every field it was sent. So a
colleague you connected to could read your API key, point your model and relay
at their own server (after which each correspondent's prompt, built from desk
history, went to them), switch workflows on and plant one that filed lines
signed by you every fifteen minutes, add a root for you to trust, or overwrite
this masthead's own withdrawal list. Found by running an outside threat-model
skill against the code, not by the tests. Both directions are now an
allow-list: the people (public halves only), desks, lines, record and held
proposals, plus the masthead's name. Nothing else is sent, and nothing else is
read.

**The record, which a peer could replace — fixed.** The record was on that
allow-list and merged by replacement, so a peer's copy of the event log took
the place of ours: entries dropped, reordered or rewritten, under a chain that
was internally consistent. The fix is not the union the outside threat model
suggested. A union of two hash chains that both grew since they last met is not
one chain, and it would have broken every guarantee the record's tests pin down
— that removing, reordering or rewriting an entry is caught. Two records are
two witnesses instead. Ours is never taken from a peer. Theirs is kept beside
it, filed under their identity, and checked by the same walk: links, payload
hashes, seals. Every later copy they send is held to their last one the way an
anchor is — the head we kept must still be there, with at least as many
entries behind it. A peer who rewrites what they told us is refused, the
earlier copy is kept, and our own record logs the divergence. A record sent in
our name is refused outright. The one exception is honest and bounded: a copy
at the 400-entry limit may have trimmed past what we held, and that is the only
case in which the old head is allowed to be missing.

**Losing your workspace to your own tests — fixed, but worth knowing.** Until
the audit, running the smoke tests removed the real masthead from storage and
restored it only at the end; a run that died in between destroyed it. The runner
now parks it under a separate key and boot restores a parked copy. If you ran
the tests before this fix and lost a workspace, it is gone.

**Denial of service, quota exhaustion, or a hostile import.** A crafted
workspace file or Slack export can fill storage or make the UI unusable. Import
validates shape, not intent — though shape is now checked before anything is
replaced, so a broken file is refused rather than saved and then crashed on.

**A verifier that fetches.** Checking a credential whose issuer is a `did:web`
makes this browser fetch a document from a domain the issuer chose, and checking
one whose withdrawal list is hosted makes it fetch that list from an address the
issuer chose. That is how both mechanisms work, and it means presenting a
credential to Byline can learn the verifier's address and the time. `did:key`
credentials with a local list trigger no request.

**The relay, if you run one.** It sees the two connection descriptions, which
contain the IP addresses of both machines; it sees which withdrawal list was
fetched when; and if you let it deliver webhooks it sees those payloads. It
never sees the masthead. A room code is six characters from an alphabet of
thirty-two, good for fifteen minutes; a second offer or answer under the same
code is refused, so a guesser has to arrive before the real other side does,
and a per-address rate limit (120 requests a minute by default) makes a
guessing loop slower than the room lives. Guess it anyway and you are handed a
copy of the masthead the moment the connection opens, exactly as a person who
was sent the long code by hand would be. Publishing and delivery can be put
behind a bearer token; rooms are always open. Delivery goes only to hosts you
named, and only over http(s). Do not put a room code where strangers read.

**A name on the relay's allowlist that points somewhere else.** The allowlist
names the hosts `/deliver` may be asked for. DNS decides where a name goes, so
the relay resolves it, refuses any answer outside globally routable address
space, and connects to the address it checked rather than to the name — a
loopback, LAN, link-local or cloud-metadata answer is refused even when the
name is allowed. `BYLINE_RELAY_ALLOW_PRIVATE=1` removes that check for an
endpoint on your own machine, and then an allowlisted name that resolves to
`169.254.169.254` is delivered to. Do not set it on a host whose metadata
service matters.

**A source that answers for ever.** A `did:web` document, a hosted withdrawal
list and a webhook's reply all come from an address somebody else chose. Each
is read with a size ceiling and a deadline, and a source that exceeds either is
refused the way a bad signature is. Before this they were read whole, and an
endpoint that never finished would have grown until the tab did.

**A stolen key that rotates first.** A byline promises its next key in the
record before it needs it. A thief of this browser profile who has not also
taken the downloaded recovery key can sign a handover, but not the planned
one — a verifier sees the promise broken and the handover marked. A thief who
took the profile *before* the recovery key was downloaded has the promised key
too, and can make the planned handover; the settings page says so until the
file leaves.

**Model providers.** Turn on a hosted model and your desk contents go to that
provider under their terms. The local-model path (Ollama) is the only one where
nothing leaves the machine.

---

## What it does protect against

**Forging someone's byline.** Every line is signed with a real ECDSA P-256 key.
You cannot file as another correspondent without their private key, and the
interface shows verification state per line rather than asserting it globally.

**Editing the record after the fact.** The record is an append-only hash chain
where each link is *individually signed* by the actor. An earlier version was
forgeable — the chain hash was unkeyed, so anyone could delete an entry and
recompute every link downstream. That attack is in the test suite now, and it
fails.

**Deleting or reordering entries.** Both break the chain and are reported at
the point of failure, not as a general "invalid" state.

**An anchor the record has outgrown.** The record keeps a bounded tail. It now
keeps whatever an anchor witnessed for as long as it can (1,200 entries), and
reports an anchor it can no longer hold as stale rather than as tampering — but
an anchor is only checkable for as long as the entries it points at exist.
Export the record before it trims if an old anchor must stay checkable.

**Truncating the record.** Chopping off the newest entries leaves a valid-looking
chain — this was a real hole, found because a test deleted the newest entry and
passed. Anchoring publishes a head fingerprint outside the browser, so a shorter
chain than the anchor is detectable. This only works if you actually made an
anchor and kept it somewhere Byline cannot reach.

**Redaction being used to hide tampering.** The chain runs over a hash of the
data, so a line can be redacted while the chain still verifies — and a redacted
entry whose content was *also* altered still fails, because the hash is checked
against the data for every entry that has not been redacted.

**A correspondent acting beyond what it was given.** Authority is a signed
credential with explicit scope and expiry, checked on every act. A correspondent
whose credential does not grant filing does not file, whatever its settings say.

**Escalation through delegation.** A correspondent can pass on a strict subset of
its own authority and no more. Claiming a scope it was never given, outliving its
parent, or naming a parent credential it does not hold — all three are refused,
and all three are tested.

**Being made the successor of a key you never agreed to.** A handover carries
the new key's own signed acceptance of the old one. A handover pointing at a
key that did not consent, or whose acceptance names a different predecessor, is
refused.

**A withdrawal that stays home.** When the list is hosted, a credential issued
afterwards names the hosted address, and a verifier on another masthead fetches
it. Shown between two origins: accepted, withdrawn here, refused there.

**A stolen credential.** Credentials alone are bearer tokens, so presentation
requires proof of possession: the holder signs the credential together with a
challenge the verifier just invented, using the key the credential names. A copy
without the key is useless.

**Replay.** A presentation answers one challenge at one domain. Reusing it
elsewhere, or later, is refused.

**Leaking claims you didn't mean to share.** Selective disclosure hashes each
claim into the credential; the holder reveals only the ones it chooses. The rest
are not blacked out — they were never in the document handed over.

**Trusting a stranger's chain by accident.** A delegation rooted outside your
masthead does not verify until you say, explicitly, that you trust that root.

**Silent data loss between peers.** Two people editing one galley from the same
version no longer means one edit vanishes; the losing text is kept and marked.

**Silent data loss between windows.** Two tabs of the same masthead used to
overwrite each other's lines. A save now folds in what the other window wrote
first, using a baseline so that what this window deleted stays deleted. One
thing it cannot reconcile: the record is a single signed chain, and two windows
appending to it at the same moment fork it. The longer chain is kept and the
other window's entries from that moment are lost from the record — not from the
desk, only from the audit trail. Use one window when the record matters.

---

**A masthead that names a byline who is gone — fixed, and worth knowing.**
The stored copy keeps the owner rather than whoever is reading, and the owner
was taken from a variable that outlives a masthead. It could name somebody who
was not in the workspace, and boot then died on every reload with the whole
desk still in storage. A save now names only an owner who exists, and boot
repairs a dangling one by reading as a real identity and recording the
substitution in the record. If you have a masthead that will not open, this
was the cause.

## A note on what a screen reader has and has not heard

NVDA has read Byline's onboarding — the title, the document, and both buttons,
correctly named. It has not read a seeded masthead, so what it makes of the
desk, the byline chips, and the announcement of a new line is still unknown.
The keyboard behaviour underneath is tested: every stop is named, no control
jumps the reading order, a dialog takes focus and hands it back, the actions on
a line are one tab stop rather than seven, and a new line is announced once
instead of re-reading the run. Those are checks a machine can make. Whether it
is pleasant to use with the screen off, nobody knows.

## A note on what "tested" covers

The suite runs in Firefox and Chrome, at a desktop window and at a phone
window, and the phone tests measure the real layout rather than inspecting the
stylesheet. What that does not cover: a real touchscreen, a real on-screen
keyboard, Safari on iOS, and any browser not on the machine that ran it.
Emulation gets the viewport, the pointer type and the user agent. It does not
get a thumb.

## Reporting

This is a prototype built in the open. If you find something, the honest place
for it is the same as the rest: write the failing test first.
