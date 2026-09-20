# How Byline got here

The build diary, pass by pass, kept as it was written — including the claims
that were later retracted and the bugs that were the author's own. The README
is the front door; this is the evidence behind it. Numbers in each pass are
what was true at the end of that pass.

## What looking at it found that the tests did not

After all of that, the first screenshot of the running app showed a workspace
called "Test Masthead" owned by "Test Runner". **Running the tests had
destroyed the real workspace.** The runner removed it from storage at the start
and put it back at the end — so any run that died in between (a closed tab, a
crash, a mutant that never finished) left the seed behind and the person's
masthead nowhere. It now parks the real workspace under its own key, and boot
restores a parked copy whenever it finds one.

Then running past the record's written-down ceilings, which no test had crossed:

- **Every anchor older than 400 events reported tampering.** The record keeps
  its newest 400 entries; an anchor points at one of them; once it was trimmed,
  checking the anchor said "entries have been removed from the end or
  rewritten" — about a record nobody had touched. The trim now keeps what an
  anchor witnessed (bounded at 1,200), and an anchor the record has genuinely
  outgrown is reported as *stale*, in different words, rather than as an attack.
- **A credential with a status-list index past 131,072 could never be
  withdrawn.** The bitstring was allocated at the spec's minimum size and a bit
  beyond it was written into thin air — revoked here, live everywhere else. The
  list now grows past the floor.
- A refusal nine links deep in a delegation chain repeated "the authority it
  rests on does not hold —" once per link.

Also checked by eye and found sound: the desk at desktop and phone widths,
Settings, the record page, and the delegation editor. One of those screenshots
showed the editor as a barely-visible ghost; computed styles said it was fully
opaque and the pane reported zero frames rendered, and a retry composited it
correctly — which is why a screenshot is checked against a measurement before
either is believed.

Not fixed, deliberately: the app has no light theme (the landing page does).
That is a design decision, not a defect, and a full second palette is a scope
change rather than a fix.

### The second pass: the rest of the screens, the rest of the ceilings

Fifteen more states looked at by eye — onboarding, the thread panel, the galley,
the wire, the conference, search, and every dialog: correspondent editor, both
OpenID4VP sides, peer connection, Slack import, credential viewer, selective
disclosure, the challenge. All legible. Two copy defects found by reading them
as a person would: the wallet dialog asked for `credentialSubject.authorisedByName`
where it should say "who authorised it", and onboarding promised *"Already on
Nostr? Your existing key works here"* — when "use existing key" runs
`prompt('any string works')` and mints a fresh signing key regardless. Both
reworded to say what actually happens.

Eight more ceilings crossed, five of them bugs:

- **Search silently capped at 120.** Two hundred matches, 120 shown, no note.
  It now says "the newest 120 of 200 results".
- **The galley was silently cut at 2,000 characters inside the model's prompt.**
  A correspondent got half a brief and no sign it was half. The cut is now
  marked in the prompt with how much is missing, and the galley editor tells you
  how much of a long brief correspondents actually receive.
- **A Slack import saved the entire masthead once per line.** Measured at
  28.5ms a line — a 2,000-line export would freeze the tab for 57 seconds.
  Imports now save once at the end: 0.4ms a line, under a second.
- **Held proposals rendered without limit** — a thousand of them painted a
  thousand rows on the desk. Capped at twenty, with the true count shown.
- Notifications were cut mid-word at 180 characters; now cut on a word with an
  ellipsis.

And three probes of mine were wrong before they were right: one measured the
sidebar's outer element instead of its scroll container and reported desks
unreachable; one set a tab id that does not exist and reported the galley
broken; one set the wrong query field and reported search empty. Each was
checked against the real control before being believed, and each time the
product was fine. Six thousand lines on one desk, 125 desks, and a
1,200-entry record all render and save without trouble.

### The third pass: the clock, and broken files

Every test so far ran inside one second of wall time, and every importer had
only ever seen well-formed input. Pushing `Date.now` forward and feeding the
importers deliberately broken files found four more:

- **A delegation dated to start next week authorised the correspondent today.**
  `validFrom` was never checked. It is now, with five minutes allowed for clock
  skew.
- **A 30-day delegation ran out without a word.** At day 25 the card said
  "until 5 October" and nothing else; at day 31 the correspondent simply
  stopped filing. The card now warns inside the last week and says "Expired"
  after.
- **A message from 400 days ago was dated "Friday, Aug 1"** — no year. Dates
  outside the current year now carry it.
- **A masthead file with no people, or with an owner who was not in it, was
  saved and then crashed render** — the app was dead on every reload until a
  reset. Files are now checked for whether they can be lived in *before*
  anything is replaced, and refused with a reason.

Two smaller ones from the same pass: a status-list index of a trillion was
accepted, and publishing the list would then have tried to allocate 125GB (now
refused past sixteen million); and a Slack row with an impossible timestamp
printed "Invalid Date" into the line (now undated).

Held up under hostile input, and pinned with tests so it stays that way: every
malformed credential, request and peer code was refused with a message; an
`alg: none` JWT was refused; `__proto__` keys in a Slack export or a workspace
file polluted nothing; and HTML in a display name, a channel name, a person's
name or a masthead's name rendered inert — checked as live DOM handlers, not
as strings, because an escaped payload looks identical to a dangerous one in a
string match.

### The fourth pass: two windows at once, and an accessibility engine

**A line filed in one window vanished when another window saved.** Both tabs
of the same masthead share storage; window B saving from a copy it read before
window A wrote simply overwrote A. Saves now fold in anything newer in storage
first — and the merge needed a baseline, because a plain union brought back a
correspondent one window had let go and desks another had removed. Something in
storage but not in memory is either *new from another window* or *deleted here*,
and only a snapshot of what this window last read can tell those apart. The
record is a single signed chain and two windows appending at once would fork
it; the longer chain is kept, and the threat model says so.

Fixing that exposed a defect in the test runner itself: it shared the live
storage key with the app, so an app tab open during a run fed its own workspace
into the suite. Two tests failed, the merge looked guilty, and it was innocent.
The suite now uses its own key and never touches a live masthead — which also
turns the park-and-restore mechanism into a safety net rather than a need.

**axe-core, run for the first time**, failed one rule in twenty places on the
desk (dim labels at 3.36:1 against the panel; the token is now above 4.5:1 on
every surface, pinned by a test that computes the ratio) and three more on
Settings: six toggle switches a screen reader announced as "button", and fields
whose `<label>` never carried a `for`. Every paint now gives switches a role, a
state and a name, and ties each label to the control after it. Desk, Settings,
the record, the galley, the wire and the dialogs all pass clean. This is an
engine's opinion, not a screen-reader user's; that gap stays on the list.

And a slice error of my own: `render()` is one line, so "the next closing
brace" after it belonged to a different function, and the decorator spent one
run attached to the crash banner.

### The fifth pass: a second engine, and a soak

Every test had run in one Chromium. `?test=1&report=<url>` now lets the suite
post its verdict to a tiny collector (`interop/report-server.py`), so a browser
nothing is driving can still run it. Firefox 152, headless, fresh profile,
30 seconds: **118 pass, 3 fail** — one product bug and two Chromium assumptions
in the tests.

- **A sub-delegation could outlive its parent by one second.** Issued "for
  thirty days" under a parent also on thirty days, the child's end was computed
  a moment later; if the second boundary ticked between the two calls, the child
  ended a second after its parent and was refused for outliving it. Chromium
  was fast enough to hide it every time. The issuer now absorbs that rounding —
  and only that: a child that genuinely asks for more than its parent keeps the
  request and is refused for what it is.
- **`localStorage.setItem = fn` is not an override in Firefox.** Storage's
  named-property setter just stores a key called "setItem". The quota test's
  fake never fired — and the import-saves-once spy was counting zero and passing
  vacuously. Both now replace the method on `Storage.prototype`, and the spy
  asserts it saw at least one write.
- Firefox's `TypeError` wording is not Chromium's; the crash test now throws a
  message of its own instead of matching an engine's.

The fixes could not be re-verified in Firefox at the time: killing the first
headless run triggered Firefox's own updater, and the install was left in a
broken side-by-side state. Two passes later it was reinstalled and the whole
suite passed in Firefox 155 — see the seventh pass.

**The soak.** Twelve and a half minutes with a rule filing every minute, in a
background tab. Heap flat at 5.3–5.7MB, zero new intervals, zero live timeouts,
DOM growth exactly the lines posted. No leak. The first probe reported
seventeen pending timeouts — it had never accounted for `clearTimeout`, so
every cancelled timer counted as pending for ever. Corrected before it was
believed. One limitation noted rather than fixed: a rule that files every minute
adds about 1,400 lines a day, and desks have no length bound, so it will reach
the storage quota in weeks — the quota is handled, but the growth is by design.

### The sixth pass: the wedge, the keys, and a server that holds nothing

The rating stalled at "8.5 as a prototype, 3 for a team on Monday", and the gap
was not code. So this pass did the three things that were: said what it is for,
made keys survive a stolen laptop, and shipped the server-shaped fifth.

- **Positioning.** The landing page and this file no longer call it a Slack
  alternative. Nobody moves a team's chat for a signature. It is a signed
  newsroom for desks where the record has to hold up — newsrooms first because
  the product is built as one, legal and compliance because that is where the
  money for provenance already is.
- **Succession.** `rotateKey` used to be a local fact. It now issues a
  `KeySuccession` credential signed by the retiring key, carrying a
  `KeySuccessionAcceptance` signed by the new one. Both halves are checked: a
  handover whose acceptance was signed by someone else, or whose successor
  accepted a different key, is refused. A stolen key can still sign a handover
  — rotation is for age, not compromise — but nobody can be made the successor
  of a key without consenting.
- **Passkeys.** `lockKeys('', 'passkey')` enrols a discoverable credential with
  the PRF extension, derives an AES-GCM key through HKDF from the PRF output,
  and wraps every private key. An authenticator that does not offer PRF is
  refused *before* anything is encrypted. Three tests drive it with a fake that
  honours the WebAuthn contract: the same device opens it, a different device
  does not, no private scalar survives in state. This Chromium reports a
  platform authenticator with `extension:prf`, but enrolment needs a user
  gesture and a PIN, so no real authenticator has touched it.
- **The relay.** `interop/byline-relay.mjs`, no dependencies. Rooms: an offer
  and an answer under a code, long-polled, gone in fifteen minutes; a second
  offer or answer for a code is refused. Status: `PUT /status/<name>` stores a
  signed `BitstringStatusListCredential`, `GET` serves it. DID documents:
  `PUT /did/<name>` serves at `/<name>/did.json`, so `did:web:<host>:<name>`
  resolves. Lists and documents persist in `_relay.json`; rooms do not.
- **The proof, between two origins.** `127.0.0.1:8123` and `localhost:8123`
  are different origins with different storage, so two windows made two
  mastheads with two owners. The first hosted its withdrawal list on the relay
  and issued a delegation pointing at it. The second, holding neither key,
  fetched the list over the network and accepted the credential. The first
  withdrew it; the push happened without a second step; the second refused it:
  *withdrawn — the list at http://127.0.0.1:8126/status/community says so.*
  Then a room code, `C9J8NZ`, typed into the second window: both sides
  `connected`, data channel `open`, each showing the other's name.
- **Dead surfaces found on the way.** The STUN address was read by the peer
  code and settable nowhere. The masthead page showed a `hosted / self-hosted`
  pill and a `wss://relay.buzz.xyz` address from a previous life of this file,
  neither connected to anything. The last onboarding button said "Enter Buzz".
  All three are gone; the relay and STUN fields are real and saved.

### The seventh pass: everything on the list that did not need another person

The list after the sixth pass had thirteen items. Five needed someone else —
a buyer, a reviewer, a stranger at a screen reader, a real authenticator with
your PIN, a second machine on the internet. The other eight were done here.

- **Keys never sit in storage in the clear once locked.** Unwrapping used to
  put the plaintext JWK back into state, where the next save wrote it to
  localStorage — so "keys at rest" held only until the first unlock. An
  unwrapped key is now a non-extractable `CryptoKey` in memory; state keeps
  the wrapped form; a save after unlock writes no scalar. Taking the lock off
  asks once more and puts the plaintext back — the test that found this
  would otherwise have found data loss. The promised next key is wrapped
  under the same lock, which the test also insisted on.
- **A Content Security Policy with a hash-only `script-src`.** The page's one
  inline script is allowed by its SHA-256; any other inline script — pasted,
  injected, imported — is refused by the browser. `interop/csp-hash.py`
  re-stamps the hash; a stale one stops the whole application, loudly. Found
  on the way: a raw NUL byte inside a string literal, which the HTML parser
  had been silently turning into U+FFFD — the hash disagreed until it was
  written as `\u0000`. Inline styles remain allowed; they are everywhere.
- **Pre-rotation.** A byline now promises, in the signed record, the hash of
  the key it will rotate to. A handover to that key is *planned* and
  *witnessed*; a handover to any other key verifies but is marked as
  unplanned, with the broken promise named. Download the recovery key and it
  leaves the browser — from then on a thief of this profile can sign a
  handover, but not the planned one. Three tests: the promise kept, the
  thief refused, the file honoured.
- **The relay, hardened.** A bearer token for publishing and delivery, a
  per-address rate limit that cuts a room-code guessing loop off at the rate
  (a test guessed 33 times and was stopped), and webhook delivery to an
  allowlist of hosts — `POST /deliver` will not forward to a host it was not
  told about, nor to anything but http(s). `interop/relay-test.mjs` drives
  all three from outside: 11 checks.
- **Webhooks leave.** With a relay set, the wire's webhook step goes out
  through it and the endpoint's own answer is what the inspector records,
  refusals included.
- **SD-JWT VC with key binding.** The IETF form: flat claims under a `vct`,
  the holder's key in `cnf`, and a `kb+jwt` at the end of a presentation
  over the exact string presented, the audience and the nonce. A copy without
  the key, a replay against another nonce, a binding by the wrong key, a
  disclosure added after binding — all refused. `interop/verify-sdjwt.mjs`
  reads a presentation with `jose` and `node:crypto`: 13 checks.
- **Presentation Exchange.** A `presentation_definition` is translated into
  the DCQL Byline already evaluates; the answer carries the
  `presentation_submission` PE expects and the verifier follows its
  descriptor map. A missing submission, or one for another definition, is
  refused.
- **The frame.** A light theme (same tokens, different values; 26 literals
  in the stylesheet and 7 in inline styles became tokens), measured rather
  than eyeballed — the test found white on the primary red at 4.02:1 and
  the button got its own background. Bylines on grouped lines, on hover and
  focus or always. The frame in Japanese, with English fallback; copy and the
  record stay as written. An inline manifest, and a service worker that is
  registered only where `byline-sw.js` is served alongside.

**Firefox, finally.** With the go-ahead to download an installer, Firefox
155.0.1 (signature checked: Mozilla Corporation) went on, headless, fresh
profile, posting its verdict to the collector: **137 pass, 0 fail.** The
second engine is no longer a round behind. The install itself was a puzzle
worth recording: a clean install into `%LOCALAPPDATA%\Mozilla Firefox` failed
to start with *Dependent Assembly mozglue could not be found*, and so did the
same files copied to any other folder under `AppData\Local` — while the same
files launched from `C:\Heya` and from the user profile root. Something on
this machine blocks private side-by-side assembly resolution under
`AppData\Local` (McAfee is installed; the cause was not chased further).
Firefox now lives at `%USERPROFILE%\Mozilla Firefox`, and the Start Menu
shortcut points there.

### The eighth pass: two standards, verified, and one read

With the go-ahead to install reference libraries into `interop/`, the two
standards that had been refused for want of a way to check them went in.

- **ecdsa-rdfc-2019.** The cryptosuite most Data Integrity verifiers expect,
  which canonicalises the *graph* rather than the JSON. The file now carries a
  JSON-LD subset — the two W3C credential contexts, embedded, type-scoped and
  property-scoped contexts, `@graph` containers for proofs — an RDF converter,
  and RDF Dataset Canonicalization (RDFC-1.0) with the n-degree hashing and
  permutations for non-unique blank nodes. It refuses a term its contexts do
  not define, as the reference implementation does in safe mode; Byline's own
  terms live in the W3C `undefined-terms` context rather than a home-made
  one. `interop/verify-rdfc.mjs`: Byline's canonical N-Quads for the document
  and the proof options are byte-identical to jsonld.js + rdf-canonize; a
  credential Byline signed verifies in `@digitalbazaar/vc` with the reference
  cryptosuite; and one the reference stack signed is frozen into the suite,
  where Byline verifies it. A widened scope is refused on both sides; a
  reordered set is accepted on both, because the graph is the same.
- **OpenID4VCI.** Issuance: an offer with a pre-authorized code, a token, a
  credential request carrying a JWT proof (`openid4vci-proof+jwt`, bound to
  the issuer and the nonce), and a credential bound to the key that proved
  itself. Byline plays issuer and wallet; the settings page has both. One-use
  codes, single-answer nonces, audience and token checks, and a wallet that
  refuses a credential issued to a different key. `interop/verify-oid4vci.mjs`
  hands the exchange to the OpenWallet Foundation's `@openid4vc/openid4vci`
  and `@openid4vc/oauth2` with their fetch routed to the fixture: they read
  Byline's offer and both well-known documents, send their own token request
  (it matches Byline's), accept Byline's token response, verify Byline's
  proof for this issuer and nonce, refuse it against another, and read the
  credential back. Nine checks.
- **KYA-OS, read.** It is a real specification now — DIF's Trusted AI Agents
  working group, formerly MCP-I, with a repository, JSON schemas and test
  vectors. What it asks for: Ed25519 keys only (Byline is P-256), `did:key`
  and `did:web`, a delegation credential on the 2018 context with a
  `credentialSubject` of exactly `id` and `delegation`, StatusList2021,
  detached JWS proofs over JCS-hashed requests and responses carried in an
  MCP `_meta` field, a session handshake with nonce and audience, and three
  HTTP headers for outbound calls. Byline answers the same four questions with
  the same primitives and none of the same bytes. Implementing it is a real
  round — a second key type, a second proof suite, the session and header
  machinery — and it is verifiable against the repository's reference code,
  so it is now on the list as work rather than as a rule.

### The ninth pass: making the next round cheaper

Eight rounds of the same loop made the repeated parts obvious. They are now
four scripts and six skills, and the loop that cost four or five tool calls
per edit costs one.

- **`interop/dev.py`** applies a patch, re-stamps the CSP hash, extracts the
  inline script and parses it — and refuses to go on if the patch left CRLF
  or a raw NUL, the two corruptions that break the hash without erroring. A
  patch whose `assert count == 1` fails leaves the file untouched, which was
  checked by feeding it a deliberately ambiguous needle.
- **`interop/run-suite.py`** serves the file, launches every browser on the
  machine headlessly, collects the verdicts each one POSTs back, and prints
  one line per engine. It found two engines nobody had run the suite in:
  **Chrome 152 and Edge 152, both 140 pass, 0 fail**, alongside Firefox 155.
  The whole thing takes two minutes and one tool call.
- **`interop/counts.py`** reads the real test count out of the file and the
  real check counts out of the harnesses, and rewrites the numbers in the
  prose. They had been hand-edited every round, and one was wrong for two of
  them.
- **`interop/deliver.py`** refreshes the Downloads copies and prints the
  close-out checklist with the artifact URLs filled in — the interop folder
  and the memory line had each been forgotten twice.
- **`.claude/skills/`** holds six: the edit loop, the test loop, the
  close-out, the rating, the standards rule, and this project's context. They
  exist so the next session does not rediscover that the hash must be
  stamped, that a hidden pane throttles the suite, or that a standard is
  never claimed until somebody else's implementation agrees.

Found while testing them: the service worker served a cached copy when the
static server was down. That is the offline path working, observed by
accident rather than by test — the first time anything has confirmed it
outside the registration check.

### The tenth pass: a name is not a destination

Reading another local-first project (Control Center, github.com/mreflow/control-center)
turned up a defence Byline needed and did not have, and the reading was worth
more than any feature in it.

- **The relay's allowlist checked a name, not a destination.** `/deliver`
  compared the URL's host against `BYLINE_RELAY_HOOKS` and then called
  `fetch`, which does its own DNS. An allowlisted name whose DNS answers
  `127.0.0.1`, a LAN address, or `169.254.169.254` — which on most cloud hosts
  hands credentials to whatever asks — was delivered to anyway. The relay now
  resolves the name itself, refuses every answer outside globally routable
  space across IPv4 and IPv6, and connects to the address it validated with
  the `Host` header carrying the name, so nothing between the check and the
  connection can re-point it. `BYLINE_RELAY_ALLOW_PRIVATE=1` turns that off
  for a webhook endpoint that really is on this machine, and says so in the
  banner and on the index page. Severity was moderate — the relay is loopback
  and token-gated — but the sentence "delivery goes only to hosts you named"
  was stronger than the code, and that is the gap this project exists to close.
- **Three fetches were read whole before anything was checked.** The relay
  buffered a webhook's entire reply before truncating it to 2KB, and in the
  browser both a `did:web` document and a hosted withdrawal list were parsed
  unbounded. An endpoint that answers slowly and for ever filled memory before
  any check ran, and the verifier meant to fail closed simply never returned.
  All three now read with a ceiling and a deadline and refuse an oversized
  source the way they refuse a bad signature. A test drives a body that never
  ends and asserts the stream was cancelled.
- **`interop/preflight.py`** is now the single gate: no CRLF, no NUL, one
  inline script, the policy hash current, the script parses, the prose numbers
  match the code, every engine, every harness. Its first run failed on two
  real things — the landing page had drifted a test behind, and Edge gave no
  verdict.
- **Which found a defect in the ninth pass's own runner.** Killing a browser
  launcher on Windows leaves its renderer and GPU children running; twenty
  stranded Edge processes had accumulated across runs. The runner now kills
  the tree. Edge then still refused: headless Edge on this machine now renders
  nothing at all, even a `data:` URL, though it passed 140 tests an hour
  earlier. That is the machine, not Byline, and the runner now says which —
  "NOT RUN, exited without loading the page" rather than a bare failure.

Verified this pass in **Firefox 155 and Chrome 152, 141 pass, 0 fail** each,
and 112 checks outside the browser. Edge is unavailable and is reported as
unavailable rather than counted as green.

### The eleventh pass: what a phone actually shows

Nobody had opened Byline on a phone. A phone harness was the obvious way and
it cannot run here — it drives an iPhone through macOS iPhone Mirroring, and
this is Windows; its Android half is platform-neutral Python over adb, so adb
went on to check properly, and `adb devices` lists none. So the phone was
emulated instead: 375x812, touch pointer, a Pixel user agent, and the layout
measured rather than looked at.

- **Every control was too small for a finger.** Twenty-nine of twenty-nine
  were under 44px, and five were under the 24x24 CSS pixels WCAG 2.2 asks for
  — the four sidebar "+" buttons were 19x16. A coarse pointer now gets its own
  rules: the hit area grows through a pseudo-element while the glyph stays put,
  so nothing moves and every control clears 24x24.
- **The composer was shorter than its own placeholder.** 44px tall holding
  59px of text, so the second line of "File to #newsroom — @mention a
  correspondent to put it to work" was cut off on the app's primary input.
  Now 62px, and the whole prompt reads.
- **The desk name was squeezed to 69% while the tab strip held 129px.** The
  title now takes the free space before the tabs give way, and shows 85%. At
  375px a name that long cannot fit beside three tabs and three icons, so it
  truncates with an ellipsis — which is correct, and the test says so rather
  than demanding the impossible.

Two things it found that were not defects, which mattered as much:

- **The drawer looked inverted and was not.** Closed measured on-screen and
  open measured off-screen, reproducibly. The Browser pane stops rendering
  while it is hidden, so CSS transitions freeze mid-flight and every geometry
  reading is a lie. With the pane visible the drawer closes to -256px and
  opens to 52px exactly as written. Nothing was wrong with Byline.
- **The first version of both phone tests was hollow.** The runner hides the
  app while it paints its report, and a hidden element measures 0x0: the title
  check read a 0px element, and the touch-target check filtered every control
  out as invisible and passed having measured nothing. They now put the app
  back on screen, and assert there are at least eight controls to measure
  before asserting anything about their size. Both were then mutation-tested —
  the fixes removed on purpose — and both went red naming the exact controls.

`python interop/run-suite.py --mobile` runs every engine at a 390x844 window,
which is what makes those tests real; at a desktop width they report what they
would have checked instead of passing quietly.

Verified in **Firefox 155 and Chrome 152, 143 pass, 0 fail** each, at both a
desktop window and a phone window. Still never on real hardware: emulation
gets the viewport, the pointer type and the user agent, and gets nothing about
a real touchscreen, a real keyboard sliding up, or Safari on iOS.

### The twelfth pass: by keyboard, and a screen reader

Accessibility here rested on axe-core, which is a linter, not a user. Two
things a linter cannot see turned up immediately.

- **Every action on a line was invisible while focused.** The react, reply,
  pin, edit and spike buttons were revealed by `:hover` alone, so a keyboard
  user tabbed onto controls that were at `opacity: 0` — operable, and
  unseeable. They are also seven tab stops per line: on a desk of thirty
  lines, over two hundred of them between the top of the page and the
  composer. They are now a `role="toolbar"`: one tab stop, arrow keys inside
  it, `Home` and `End`, the stop following the focus, and revealed by
  `:focus-within` as well as `:hover`.
- **A new line was announced by re-reading the whole desk.** The run sits in
  a `role="log"` region, and every repaint replaced its contents wholesale
  with `innerHTML`. To a screen reader that is not "one line arrived" but
  "every line on this desk arrived" — the entire run read out again on a
  reaction, a settings change, anything at all. The region no longer announces
  itself; a line that is genuinely new is announced once, as a sentence:
  *Scout filed on newsroom: the tide turned at four.* Your own lines are not
  announced back to you.

Found by inspection while setting the reader up, not by hearing it. **NVDA
2026.1.1 is installed and configured** — silent synthesiser, speech written to
its log — and it did read Byline: the page title, the document, and both
onboarding buttons with their correct names and roles. Reading the running app
needs focus inside the page, and the attempt to drive that ended when the
machine's antivirus blocked the input-synthesis script, which is a fair thing
for it to block. What a screen reader says about a seeded masthead is still
unheard.

**And the hangs were never hangs.** Three times a deliberately broken build
made the headless suite report nothing rather than fail, and it was written
off as flakiness. It was the Content-Security-Policy hash: an edit inside the
inline script invalidates it, the browser then refuses to run the script at
all, and the page loads, does nothing, and reports nothing — which from
outside is indistinguishable from a hang. `run-suite.py` now checks the hash
before it launches anything and says so. The suite also carries a watchdog
that posts a partial verdict, naming the test it was inside, rather than
going silent.

**Two more found on the way.** `relay-test.mjs` passed its seventeen checks
and then held the gate open for five minutes: its relay children inherited
stderr, so under a parent that captures output a surviving grandchild kept
the pipe open. And one Firefox run in four failed seven credential tests,
all traceable to a single identity with no `did:key` — the reason swallowed
by a bare `catch`. The catch now records what the engine refused, a second
attempt drops the `key_ops` and `ext` hints from the JWK, and a test asserts
that every identity holding a key holds an identifier. Three Firefox runs
since are clean, which is not proof the cause is gone — only that the next
occurrence will name itself.

Verified in **Firefox 155 and Chrome 152, 148 pass, 0 fail** each, at a
desktop window and a phone window, with 112 checks outside the browser.

### The thirteenth pass: dead on reload, found sideways

Trying to finish the screen-reader read produced no screen-reader reading and
one of the worst bugs this file has had.

**A masthead could be written that killed the application on every reload.**
`save()` keeps the *owner* in the stored copy rather than the reader, so a
second window signed in as somebody else does not overwrite who owns the
desk. But `OWNER` is a module variable that outlives a masthead: after a test
run, or a fresh seed in the same tab, it can name somebody who is not in this
workspace at all. The stored `meId` then matched nobody, `me()` returned
undefined, and boot threw on `.name` — every desk, every line and the whole
record still sitting in storage, and no way back in. Two fixes, because it was
two faults: a save now substitutes an owner only if that person exists, and
boot repairs a masthead whose `meId` names nobody by reading as a real
identity, recording the substitution in the record, and saying so. A workspace
holding no identities at all is reported rather than guessed at. Proved
against the actual broken state, not a synthetic one: the same storage that
had been killing boot opened, read as the right person, with all eight
identities and every desk intact.

It was found because the browser pane went quiet, and chasing that turned up
three separate things that all looked like the same thing:

- **The static server had stopped, and the service worker was serving its
  cached copy** — a build seventy kilobytes out of date. The offline path
  working, for the second time by accident, and very nearly a session spent
  testing a stale file. Read the size before trusting the page.
- **`document.body.textContent` includes the source of a blocked script**, so
  a page whose script never ran looks like a page rendering its own source.
  That is not what it is.
- **And underneath both, the real crash.**

**The screen reader could not be finished, and the reason is worth writing
down.** NVDA is installed, silent, logging, and demonstrably alive: pointed at
Notepad it announces within a second. Pointed at the browser pane it says
nothing at all — no focus changes, no live region, nothing — because the pane
is an embedded webview that exposes no accessibility tree. It reported it
earlier as "Chrome Legacy Window" and "unknown". So the pane cannot be used
for screen-reader work, and real Firefox needs focus moved inside the
document, which needs synthetic input, which this machine's antivirus blocks
and should. What remains is about two minutes at the keyboard: open
`byline.html` in Firefox with NVDA running, press Tab a few times, and read
`%TEMP%\nvda.log`. Everything else about it is set up.

Verified in **Firefox 155 and Chrome 152, 150 pass, 0 fail** each.

### The fourteenth pass: twenty broken shapes

The thirteenth pass found a stored masthead that killed the application, by
accident, while looking for something else. So this pass went looking on
purpose: take a good workspace, break it in every way a shape can be wrong —
copy that is not a list, a record that is an object, an unread count below
zero, a desk with no galley, a person who is a string — hydrate each one, and
render it. Twenty-three of them. The bar is not that the application is right
about a broken desk; it is that **the application still opens**.

Three of the twenty-three killed it on the first run:

- copy that is not a list → `msgs(...).filter is not a function`
- no masthead name → `Cannot read properties of null (reading 'name')`
- a galley that is not there → `Cannot read properties of null (reading 'v')`

All three fixed the same way: `hydrate()` now normalises the shape of
everything that arrives from somewhere other than this build — an older
version, an export, a peer, a test run — so a wrong shape becomes an empty one
there rather than an exception somewhere later. The galley guard was
mutation-tested: removing it reproduces exactly the original failure.

**And the long-running "intermittent Firefox failure" was this test.** For
several passes one identity would occasionally lose its `did:key` and seven
credential tests would fail together. The new test replaced `S` with a
rehydrated clone when it was done — which detached the person objects every
later test was holding, so `nib.delegation` was written to an object no longer
in the masthead. It now restores the real state object *by identity* and
asserts that it did. Eight consecutive clean runs followed. The bug was mine,
and it had been blamed on the browser.

### The fifteenth pass: following the fix, and finding a key on the wire

The fourteenth pass ended with a question rather than a green run: *does
anything else replace the state mid-flight?* One grep answered it. `pullState`
merges people and desks in place and carries a comment saying why — an agent
run holds a reference to its own correspondent across every await, and swapping
the object out from under it leaves `busy` set on a detached copy. The peer
snapshot did `S = theirs`, replacing every person object a peer also knew
about: the same bug by a third door. It now merges onto the state it already
has, and a test holds the objects and checks they are the same ones afterwards.

Reading that code to fix it showed something considerably worse.

**Connecting to a peer sent them every signing key in the masthead.** The
snapshot was the workspace verbatim — and a person's private JWK lives in the
workspace. Yours, and every correspondent's, straight down the data channel on
connect. Holding your key, that peer can file lines as you that verify, and the
record cannot tell. The dialogue says "the masthead itself goes machine to
machine"; nobody reading that has reason to think their byline is going with
it. Nothing warned them, and nothing afterwards would have shown it. The
snapshot was not even the only door: every line filed while a peer is connected
goes out with its author attached so the far side can attribute it — and that
was the person object, key included. One message was enough.

Both directions are now closed, and the receiving side matters more than the
sending one. A snapshot carries public material only. Key material in an
incoming snapshot is discarded; your own identity is never described by a
peer's copy of it; an identity this masthead holds the private key for cannot
be re-keyed by somebody else's; and a person learned from a peer arrives
public-only, which is all verifying them ever needed. Seven mutations were
tried against these tests and all seven went red — the first one printing the
leak as it was: sixteen private-key fields across eight identities.

The honest cost: `sec`, the toy digest scheme's secret, is also its verifier,
so a peer's legacy digest-signed lines now read as unverifiable rather than
verified. That asymmetry is the reason the real scheme exists. And the masthead
*file* still holds every key on purpose — it is a backup you open on another
machine — which makes it the one file here that must not be handed to a
colleague, and it now says so as it downloads.

Verified in **Firefox 155 and Chrome 152, 154 pass, 0 fail** each, plus the
full gate at a phone window and all eight external harnesses.

The method is the transferable part. Two passes running, the defect was found
not by testing harder but by *not stopping at the fix*: read the thing you just
changed, ask what it sends rather than what it computes, and follow the comment
that says another function learned this lesson already.

### The sixteenth pass: four skills, and a key that was not a point

Four third-party skills are installed in `.claude/skills/`, chosen from the
skills.sh registry by reading each one's SKILL.md and its security-scan
verdicts rather than its install count: Trail of Bits' `wycheproof`,
`spec-to-code-compliance` and `variant-analysis`, and OpenAI's
`security-threat-model`. Each is a verification method this project did not
already have. The ones passed over, and why: mutation testing (its tool mutates
source files and cannot run tests that live inside the HTML — `run-suite.py`
already does the job), differential review (it reads git history, and there is
none), Semgrep and CodeQL (a toolchain for one file), and property-based testing
(it fails one of the registry's scans).

**Checking whether Wycheproof had anything to bite on found the first bug.**
Byline does its own curve arithmetic in exactly one place: turning a `did:key`
back into a public key. It recovered y from x and never asked whether the
result was a point. Run against Byline's own code, with an x that has no point
above it:

```
jwkFromDidKey ACCEPTED an x with no point on the curve (x = 1)
y^2 == x^3 - 3x + b ? false
WebCrypto importKey: refused it (DataError: Invalid keyData)
```

So nothing could be verified against such a key, but everything that used a key
without importing it took garbage for an identity, and an x written as itself
plus the field prime gave one key a second identifier. Both are refused now.

**Then `variant-analysis`, pointed at that root cause** — key material from
somewhere untrusted, used as an identity without being bound to it — found four
more. Each was proven the same way before anything was fixed: a test written to
fail against the code as it stood, and run. They failed. The worst:

```
FAIL Identity / a credential is checked against the key its issuer names, not a
key filed under that name: a credential signed by one key but naming another as
its issuer does not verify: IT VERIFIED
```

Checking a credential had used the stored key of whichever person claimed the
issuer's did. A `did:key` is its key; the check now uses the key inside it. A
key-file import kept the old identifier. A peer could introduce a person under
somebody else's identifier, re-key a colleague, add a key to their past, or
lift a revocation. `THREAT-MODEL.md` has the long version, including two
things found and deliberately left as open policy questions.

Every guard added in this pass was then removed in turn to see whether a test
noticed. Ten of eleven removals failed a test the first time. The one that did
not was real: a peer could take a genuine, properly signed handover between two
keys of its own, relabel it with a colleague's identifier, and re-key them. No
test had sent one. One does now, and it catches the removal. A twelfth removal
— of the check that verification succeeded — changes nothing, because a failed
verification names no successor to move to; that redundancy is written down
here rather than tested for.

Verified in **Firefox 155 and Chrome 152, 159 pass, 0 fail** each.

### The seventeenth pass: an outside threat model, and what it found

OpenAI's `security-threat-model` skill was run against the code rather than
against `THREAT-MODEL.md`, and its report is
[`byline-appsec-threat-model.md`](byline-appsec-threat-model.md). Its two
highest findings were new, and both lived in what the peer connection carries
**besides** identities.

**TM-001:** the snapshot sent to a peer was the state minus private keys and
the lock. Everything else went: the Anthropic API key, the relay token, the
wallet with every SD-JWT disclosure in it, the workflows. **TM-002:** the
merge on the other side copied every field it was sent. The test written to
prove it, run against the unfixed code, shows the attack working — after one
hostile snapshot the local settings read:

```
"live":{"on":true,"provider":"ollama","url":"https://collector.example/desk","key":"theirs",...},
"experiments":{"workflows":true}
```

That is a model endpoint that would receive each correspondent's prompt, built
from desk history, and a workflow engine switched on for the workflow the same
snapshot planted, which files lines signed by you on a timer. The same merge let
a peer add a trusted root for you and overwrite your own withdrawal list.

Both directions are now one allow-list — people (public halves), desks, lines,
the record and held proposals, plus the masthead's name — because a deny-list
fails open on the next field anybody adds. Four mutations were tried against the
two new tests (send everything again, take everything again, take the whole
workspace, add settings to the list); all four went red.

**Found and not yet fixed:** the record (`events`) is on the list and is merged
by replacement, so a peer's copy of the log replaces ours. Lines merge as a
union; the record should too. It is TM-012 in the report.

Verified in **Firefox 155 and Chrome 152, 161 pass, 0 fail** each.

### The eighteenth pass: the old name, and a record that stays yours

**The old name is gone.** This file began life as a copy of Block's Buzz, and
still called its storage key, its local harness, its debugging handle and its
own header by that name. All four now say Byline. A masthead saved under the
old storage key moves to the new one the first time this build opens, and never
overwrites one already there; a correspondent on the old harness id moves with
it. The two old identifiers survive in one labelled constant, because a
migration has to know what it is migrating from — and a test counts the old
name in the source and fails if it appears anywhere else, on screen, or as a
global.

**TM-012, fixed — though not the way the threat model suggested.** A peer's
snapshot replaced our record with theirs. The report proposed merging the two
as a union. That would have been wrong: two hash chains that both grew since
they last met are not one chain, and the record's own tests pin down that
removing, reordering or rewriting an entry must be caught — a union would have
made every sync look like tampering. So the two records are kept as two
witnesses. Ours is never taken from a peer. Theirs is held beside it, walked by
the same verifier, and every later copy is checked against their last one as if
it were an anchor. The test, run against the unfixed code, failed on its first
assertion — our own record, replaced. With the fix: an extension is taken, a
rewrite is refused with the earlier copy kept and the divergence logged in our
own record, a broken chain is refused, and a record claiming to be ours is
refused. The record page shows each peer's record, its seals, and whether they
ever rewrote it.

Nine mutations were tried against the new tests: six against the record merge
(take it again, skip the continuity check, widen the trimming exception, accept
a broken chain, walk our record instead of theirs, accept a record in our name)
and three against the rename (overwrite on migration, skip the harness
migration, bring back the old debugging handle). Seven went red the first time.
The two that did not were a real gap: a peer's *first* copy has no earlier copy
to be checked against, so the walk is the only thing between it and being held
as verified — later copies had the continuity check as a second line, and no
test had ever sent a broken first copy. One does now, and both removals fail
it. The existing record and anchoring tests pass unchanged.

Verified in **Firefox 155 and Chrome 152, 163 pass, 0 fail** each.

### The nineteenth pass: Buzz, compared, and every attribute walked by hand

[`byline-vs-buzz.md`](byline-vs-buzz.md) compares this file with Block's Buzz,
which it began as a copy of, and rates it on the usual three lenses: **8.5** as
a prototype (holding), **3** for a team on Monday (holding), **9** for potential
(up from 8.5, because a third party shipped the same thesis and its trust layer
is thinnest exactly where this one is strongest).

The audit that came out of the comparison walked every place an identifier or a
colour lands in an HTML attribute. Text had always been escaped; identifiers had
not, because this file used to make them all. Peers now choose some. Against the
unfixed code, one hostile snapshot and one line put **eleven elements the peer
wrote** into the page, and a reaction could be markup outright — the emoji was
drawn raw. The CSP stopped any of it running; it did not stop a false "verified"
chip. Identifiers, colours and reactions are now checked where they arrive and
escaped where they land, and the test plants hostile values straight into memory
so the escaping is tested on its own. That check's first run found four sinks
the pattern sweep had missed — the quick-reaction toolbar. Eight mutations,
one per guard at the door and at the sink; all eight went red.

Verified in **Firefox 155 and Chrome 152, 164 pass, 0 fail** each.

### The twentieth pass: the five things the comparison recommended

Each was done test-first. The test was run against the unfixed code and failed,
for the reason it was written to catch, before anything was changed.

**Who is on the other end of a peer connection (TM-004).** The name a peer
announces is whatever they typed, and a room code read aloud can be answered by
whoever hears it first. Now both screens show an eight-digit code made from both
ends' DTLS fingerprints. Nothing of the masthead crosses, in either direction,
until the person here says the codes match. Anything the other side sends
meanwhile is held, then taken on confirmation or thrown away on a mismatch,
which hangs up. Somebody in the middle holds a different fingerprint on each
side, so the codes differ. The residual is written down: an attacker in the
middle of both code exchanges could grind certificates until the codes agree,
at about 10^8 tries a connection.

**Who may grant authority here (TM-005).** Any human in the masthead could root
a chain of authority, and a peer can add humans. Now a person roots authority
only if this masthead holds their key, or you have said so on the settings
page. That decision never crosses to or from a peer.

**Secrets at rest (TM-003).** The model API key and the relay token are wrapped
under the same lock as the private keys, and while locked they live only in
memory after an unlock. And the lock is offered when a masthead is made, rather
than waiting to be found in settings. It is still optional, which is the part
of TM-003 that stays open.

**What an import changes (TM-007).** Opening a masthead file now says whose key
you would be filing with, whether the file's author holds it too, and which
model, relay and workflows it brings. Its settings and workflows come in only
when ticked.

**A bridge to Buzz.** A correspondent's delegation can now go to Block's Buzz as
a NIP-OA owner attestation, as far as NIP-OA can carry it: channel messages,
until the delegation ends. The export says plainly that named scopes,
sub-delegation and withdrawal do not survive the trip. The Nostr key is derived
from the byline key it belongs to, so there is no new secret to store, lock or
leak. Signing with secp256k1 needs code the browser does not have, so for the
first time this file carries someone else's: `@noble/secp256k1` 3.2.0, pinned
by its file hash and wrapped so that only what the bridge uses escapes. Its
author says this version has not been independently audited, so it is checked
rather than trusted, three ways:
- against all nineteen of BIP-340's own test vectors, in the browser;
- against Buzz's published NIP-OA vector and signed example, and every case the
  spec says to refuse;
- by `interop/verify-nipoa.py` against libsecp256k1, Bitcoin Core's own library,
  in both directions. Given the same key, message and randomness, the two
  produce byte-identical signatures.

**What testing the tests found.** 25 mutations were tried against this pass.
21 went red the first time. The four that did not were all weaknesses in tests,
not in the code:
- **Two NIP-OA refusals, in both the browser test and the harness.** They reused
  Buzz's signature for their bad cases, so the signature check refused them
  before the rule under test was reached. Each rule now has a case only it can
  refuse, a valid signature over exactly the defect, and every refusal is
  checked for its reason.
- **One assertion that was early by accident.** It checked the passphrase
  refusal after 80 milliseconds, faster than a real lock finishes.
- **One test needed a confirmed connection.** An older test sent a line through
  a fake connection and now had to present one whose code had been compared.

Verified in **Firefox 155 and Chrome 152, 172 pass, 0 fail** each.

### The twenty-first pass: the rest of the threat model, and one worse than rated

Every remaining item was fixed test-first. Each test was run against the
unfixed code and failed, for the reason it was written to catch, before
anything changed.

**A live model filed without asking anyone (TM-011, worse than rated).** The
threat model called this prompt injection, at low. Tracing it found that when
a correspondent's reply came from a live model, the code posted it directly. It
never asked what that correspondent was allowed to do. A correspondent set to
"reads only", or "asks first", or whose delegation had been withdrawn, filed
anyway the moment a real model answered. The proof, against the unfixed code:
set to read only, it filed. Live copy now passes the same gate as scripted
copy. On top of that, it is held for release unless its owner chose "files
directly" for that correspondent, because a model reading a desk can be
steered by what is written there.

**Opening the file from disk in Chrome shared its storage (TM-003).** The open
question was measured rather than assumed. In Chrome, one local HTML file read
what another had stored, from a different folder. Firefox kept them apart. So
in a Chromium browser, a masthead opened from disk had its keys readable by
the next HTML file anyone opened. A page cannot tell which browser it is in,
so any page opened from a file is now treated as sharing:
- the lock is offered at every launch;
- a warning stays in the sidebar until the keys are locked;
- there is no "keep them in the clear" to remember.

Served over the web, declining is now a recorded choice rather than a default
nobody made.

**A peer could revoke a colleague (TM-006).** A revocation is now a signed
statement, made by the key itself or by someone who may grant authority here.
A peer can pass one on, but cannot make one. Plain data is dropped, and a
revocation made here is signed so that another masthead can check it.

**The relay (TM-008).** It no longer runs open. With no token set, it makes
one, keeps it and prints it. It refuses a withdrawal list older than the one
it holds, or one with no issue date, so a withdrawal cannot be undone by
putting the old list back. Its own tests went from 17 to 25; five of the new
ones failed against the old relay first.

**Where an issuer can send your browser (TM-009).** Withdrawal lists and did:web
documents are fetched over https only, never from a loopback, private or
link-local address, except from the relay you configured.

**The test link (TM-010).** `?test=1&report=` sends results only to the server
that served the page, or to this machine.

**What testing the tests found.** 15 mutations were tried, and all 15 failed a
test. One needed a second run: its anchor was an escape sequence my patch had
written in place of the character. Two of my new guards were hollow before any
mutation ran. They searched the whole script for a call, and the whole script
includes the test that searches, so they would have passed with the call
removed. They now look only at the functions they guard.

Verified in **Firefox 155 and Chrome 152, 177 pass, 0 fail** each.

### The twenty-second pass: published

A repository of its own (the working folder held a dozen other projects), LF
pinned because a CRLF checkout breaks the CSP hash, commits re-authored to a
no-reply address before anything went public, Apache 2.0, this diary split from
the README. Onboarding stopped pretending: it used to run a timer, mark every
harness "detected" and offer to "install all", none of which happened. And the
suite learned to test a hosted copy — 178 of 178 against the live https site,
in two engines, at two widths.

### The twenty-third pass: the helper, and two real agents that would not run

The one thing keeping this from being usable was that its correspondents did
not really run on anything. `interop/byline-helper.mjs` fixes that, and is the
most dangerous file here, so it was built guards-first.

Trying the real programs before writing a line found both broken on the build
machine, for reasons only their owner can fix: Claude Code printed its `init`
line and then hung for minutes, retrying a 401 on an expired sign-in; Codex was
signed in but refused by the API as too old for its account's model. Those two
transcripts became the first fixtures. The helper now stops a silent agent at a
first-output deadline and says "run `claude`, then /login", and unwraps Codex's
JSON-inside-JSON error into the sentence a person needs.

33 mutations across both halves — bind to every interface, accept any token,
answer any origin, skip the Host check, put the prompt on the command line, run
through a shell, leave tools on, leave the sandbox, hand the agent the token,
skip the authority gate, accept a helper anywhere — and 33 caught. Two needed
better tests first: the stand-in agent was a Node process, and Node on Windows
takes its ordinary children down with it, so the tree-kill could be deleted
without a test noticing until the stand-in started a detached grandchild; and
Codex's raw JSON error contained the very phrase the test looked for.

Then the seam, in a real browser against the real helper: a wrong token
refused, the right one connected, both agent formats streamed through real
CORS and preflight. What has still never been seen is a real agent succeeding.

