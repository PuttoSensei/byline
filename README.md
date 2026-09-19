# Byline

**Every agent message carries a checkable byline.**

A newsroom where the correspondents are agents. People and AI sit on the same
desks, everyone holds their own key, and every line is signed by whoever filed
it — so the record can be checked by the reader rather than vouched for by the
software. Every correspondent acts under a credential a person signed, with a
scope and an expiry, and passing authority on can only narrow it.

It is built for newsrooms first, and for any desk where *who said that, and on
whose authority* has to survive a lawyer. It is not a Slack replacement, and
stops describing itself as one here.

It is one HTML file. No build. A server is optional: the relay in `interop/`
is small, does four jobs, and holds none of your data.

**Status: a finished prototype, not a product.** It is a reference for one
idea — that an AI agent's authority should be a credential anyone can check —
with a working newsroom built around it to show the idea under load. If you
want a workspace for a team, use [Buzz](https://github.com/block/buzz), which
this file began as a study of; [`byline-vs-buzz.md`](byline-vs-buzz.md) says
where each is ahead, and Byline can export a correspondent's authority as a
Buzz `auth` tag. Nobody but its author has used it yet.

```
byline.html              the whole application (~790KB, one file, of which 58KB is a vendored secp256k1 library)
byline-sw.js             optional: served next to it, the page works offline after one visit
byline-landing.html      the page that explains it
interop/                 verifies Byline's credentials using nobody's code but other people's
interop/byline-relay.mjs the optional server: room codes, a hosted withdrawal list, did:web documents, webhook delivery
interop/relay-test.mjs   drives the relay's guards from outside: token, allowlist, rate limit, replay
interop/verify-nipoa.py  checks the Buzz bridge against libsecp256k1 (needs `pip install coincurve`)
interop/csp-hash.py      re-stamps the Content-Security-Policy hash after any edit to the file
interop/dev.py           the edit loop: patch, stamp, extract, node --check, in one command
interop/run-suite.py     runs the smoke tests headlessly in every browser on the machine
interop/counts.py        keeps the numbers in the prose true to the numbers in the code
interop/preflight.py     one gate: the file, the prose, every engine, every harness
interop/public-address.mjs  which IP addresses the public internet can route to
THREAT-MODEL.md          what it protects against, and what it does not — it leads with the gaps
byline-appsec-threat-model.md   an outside-method threat model, and what became of each finding
HISTORY.md               how it got here: twenty-one verification passes, each finding real defects
THIRD-PARTY.md           the one piece of someone else's code in the file, and the test vectors
```

## Working on it

```bash
python interop/dev.py apply <patch.py>   # patch, stamp the CSP hash, parse the script
python interop/run-suite.py              # Firefox, Chrome and Edge, headless, ~2 min
```

The file is edited by exact-match replacement from a Python patch script,
never by hand: a 760KB inline script cannot be read into an editor's context
to find a unique anchor, and the Content-Security-Policy hash has to be
re-stamped after every edit or the whole application refuses to run. `dev.py`
does the four steps in one call and refuses to continue if the patch left CRLF
endings or a raw NUL byte, both of which break the hash silently.

The tests are read from `run-suite.py`, not from a browser window. A hidden
tab throttles background timers, so a run that takes 35 seconds headless takes
minutes in a pane and every status check costs a round trip. That difference
was the single largest waste in a working session before it was measured.

## Running it

Open `byline.html` in a browser. That's the entire procedure.

**Serve it rather than opening it from disk if you use Chrome or Edge.** Those
browsers give every local HTML file one shared storage area, so a masthead
opened as a `file://` page has its keys readable by the next HTML file you
open. Byline warns about this and insists on the key lock there; over `http`
or `https` each site's storage is its own. `python -m http.server` in this
folder is enough. Served next to it, `byline-sw.js` also makes the page work
offline after one visit, and passkeys need a secure context.

To run the verification harnesses: `cd interop && npm ci`, and
`pip install coincurve` for the Buzz bridge check.

For the local-model path you'll want [Ollama](https://ollama.com) running, then
point Byline at `http://localhost:11434` in Settings. Correspondents then
genuinely think — the same file, real inference, nothing leaving the machine.

## The tests

```
byline.html?test=1
```

178 of them, in-browser, no runner. Each one is either a bug that shipped once
and got caught by hand, or an attack that has to keep failing: a forgeable hash
chain, a truncated record, a correspondent passing on authority it was never
given, a stolen credential being presented by a thief, a claim smuggled into a
selectively-disclosed credential after signing.

Three of them exist because the claims they cover were previously resting on
code I had read rather than behaviour I had seen:

- **The peer test opens a real `RTCPeerConnection`**, exchanges the SDP the real
  functions produce, and waits for actual bytes to arrive. It proves the stack
  and the signalling. It does not prove NAT traversal, and it does not prove the
  part where a person carries the code to another machine.
- **`did:web` was verified against a document served over HTTP** — a credential
  signed under a `did:web` identifier and verified using a key fetched off the
  network. The shipped test stubs the fetch so the suite stays self-contained.
- **The Slack importer was run on a real export** pulled from a public
  repository. See below.

## What's real

**Signatures.** WebCrypto ECDSA P-256, one keypair per identity, `did:key`
identifiers. Tamper with a line and verification fails.

**The record.** An append-only hash chain, each link individually signed.
Deletion, reordering and — with an anchor — truncation are all detectable. You
can verify it yourself from the record page.

**Credentials.** W3C Verifiable Credentials with real Data Integrity proofs
(`ecdsa-jcs-2019`, canonicalised per RFC 8785), plus VC-JWT and selective
disclosure. Not taken on faith: `interop/` verifies all four formats — the
credential, the presentation, the JWT and the selectively-disclosed form — using
digitalbazaar's reference implementation, the `jose` library and Node's own
crypto, each given nothing but the `did:key` string. Those canonical bytes are frozen into
the test suite, so drifting off the standard fails here rather than in someone
else's verifier.

**Authority.** Delegation credentials with explicit scope and expiry, chains
that can only narrow, and `BitstringStatusList` revocation. The credential is
load-bearing: a correspondent whose credential doesn't grant filing doesn't
file, whatever its card says.

**OpenID4VP 1.0.** The exchange wallets actually speak, both halves of it. A
verifier signs a request object (`oauth-authz-req+jwt`) naming what it wants in
DCQL; a wallet checks the request really came from the key its `client_id`
names, shows you who is asking and what for, and answers with a `vp_token`
keyed by query id. Per Appendix B the presentation's `challenge` is the
request's nonce and its `domain` is the whole Client Identifier — so an answer
is worthless to a different verifier and worthless twice. Written from the 1.0
final spec source, not from memory, and `interop/verify-oid4vp.mjs` checks a
real exchange with `jose` and `node:crypto`.

**Multiplayer.** WebRTC between machines. With no relay you carry two codes
across by hand; with one (`node interop/byline-relay.mjs`) you read out a
six-character room code and the relay carries the two codes for you. Either
way the masthead syncs directly with nothing in between. Proved between two
origins in two windows of one browser — which shows the stack, the relay and
the handshake, and not NAT.

**Keys that survive more.** Rotating a key leaves a signed handover: the old key
names the new one and the new one signs its acceptance inside it, so copy filed
under either can be tied to one byline by any verifier. Keys at rest can be
wrapped under a passkey — the WebAuthn PRF extension gives a secret only that
authenticator will ever produce, and the wrapping key is derived from it on
each unlock. That path is tested against a fake that honours the contract; it
has not yet met a real authenticator, and the settings page says so.

**A withdrawal that travels.** The `BitstringStatusList` can be hosted on the
relay; credentials issued afterwards point at that address, every withdrawal
made here is pushed there, and a verifier elsewhere fetches the list, checks
its proof and its issuer, and refuses on a set bit — or on a list it cannot
read, which fails closed.

## Built, but never seen working

**Voice.** Audio is meant to ride the same peer connection — `getUserMedia`,
`addTrack`, a level meter, no server. The code is there and the failure path is
tested: deny the permission and it says so and recovers cleanly. But every
environment this was built in blocks microphone access, so **no one has yet
heard a second of audio come out of it.**

That is a meaningful distinction on this project. Two other claims sat in
exactly this state — written, plausible, unobserved — and testing proved both
wrong. Until someone plugs in a microphone, this is the least trustworthy
sentence in the README.

**The rest.** Search, threads, attachments (in IndexedDB), the galley, workflows
including scheduled ones, huddles with signed transcripts, Slack import,
live sync between windows.

### What running the Slack importer on a real export taught it

Written from the format, it looked fine. Run against an actual export it was
quietly wrong in two ways, and both only showed up because the export was real:

- **There was no `users.json`.** That file is optional, and plenty of exports
  don't have one — every message carries its own `user_profile` instead. Without
  reading those, every name and every `@mention` came out as a raw Slack id.
- **Six rows in thirteen were Slack talking to itself** — joins, a rename, a
  topic change, a purpose change. Three of them were being filed as things
  people had said, in the third person, under their names. Those are now skipped
  and counted, and the topic and purpose events are used for what they actually
  are: the desk's topic, recovered from an export with no `channels.json` in it.

It also handles DMs and private groups (folders named by id, membership in
`dms.json`/`mpims.json`, so a year of direct messages doesn't arrive as a desk
called `d01abcdef`), files (named and sized, linked back to Slack, openly not
held — an export only contains the bytes if whoever made it asked for them), and
emoji shortcodes, where the ones people actually type convert and anything
unrecognised is left exactly as written rather than guessed at.

The shipped test uses invented content in exactly that shape. The real messages
belong to the people who wrote them and aren't redistributed here.

## What isn't

The named coding harnesses — Claude Code, Codex, goose — are working styles,
not engines. A page cannot start a local process; onboarding and every
correspondent's card say so, and nothing pretends to detect or install them.
Real thinking comes only from a local model through Ollama, or the Anthropic
API. Webhook deliveries are simulated unless a relay is set, in which case they
go out through it to the hosts it was told about. Correspondents answer in
text, never in voice.

Byline uses the same primitives as DIF's KYA-OS but not its wire protocol.

OpenID4VP and OpenID4VCI here have no network hop: `response_mode` says
`direct_post`, the issuer identifier is an `https://byline.invalid/…` name
that nothing fetches, and every message is carried by hand, the same way the
peer-connection codes are. There is no `request_uri`, no encrypted response
(`direct_post.jwt`), no authorization-code grant and no transaction code — so
credentials can originate elsewhere now, but only
originate inside Byline.

What *has* been settled: `@openid4vc/openid4vp`, an independent implementation,
reads Byline's request and response, identifies the request as spec version
101, and its DCQL reader finds the presented credential. That is protocol
structure accepted by a foreign implementation. It is not the same as a
round trip with a shipping wallet over a real network, which remains untested.

And the tests themselves have been falsified. `interop/falsify.mjs` runs 27
mutations against the interop fixtures; `interop/falsify-app.mjs` writes 33
mutants of `byline.html`, each missing one load-bearing guard, and requires the
suite to notice. Between them they found eleven checks that were passing
whatever happened — two in the harnesses, nine in the suite, most of those
passing *for the wrong reason*: a neighbouring guard was catching the tampering,
so the guard under test could be deleted without a single red. It also caught
two kills that were not kills — a crash the unmutated file produced too — and
an order-dependent test that only worked because something earlier had always
run first. All are now killed by tests confirmed to fail against their mutant
before passing against the clean file.

Run `?test=1&only=Delegation` to run one slice of the suite; that seam exists so
mutation testing costs seconds rather than a minute per mutant.

## How it got here

Byline was hardened in twenty-one passes. Each pass applied a verification
method the last one had not — a second browser engine, a soak, mutation
testing, hostile input, a phone-sized window, a keyboard walk, a screen reader,
deliberately broken stored state, an outside threat model, a comparison with
Buzz — and every one of them found real defects, several of them serious: a
masthead that died on reload, private keys sent to a peer, a live model that
filed without asking what it was allowed to do. [`HISTORY.md`](HISTORY.md) is
that record, mistakes included. The ratings it arrives at: 8.5 as a prototype,
3 for a team on a Monday, 9 for the idea.

## What it still needs, and cannot give itself

- Anyone but its author using it.
- An outside security review. `THREAT-MODEL.md` is the map for one.
- A real authenticator for the passkey path, a real microphone for voice, a
  real phone, a screen-reader user, and two machines on different networks.
  Each of those claims is marked in the interface or here as unobserved.
- mdoc (doable, pointless for a newsroom) and KYA-OS's wire protocol (read,
  scoped, not built).

## Reporting a security problem

Open a private advisory on the repository rather than a public issue. Expect a
reply, not a bounty: this is one person's prototype.

## Licence

Apache 2.0 — see [`LICENSE`](LICENSE). The one piece of third-party code in
`byline.html` is `@noble/secp256k1` (MIT); see [`THIRD-PARTY.md`](THIRD-PARTY.md).
