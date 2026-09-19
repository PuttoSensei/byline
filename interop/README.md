# Checking Byline's credentials with someone else's code

*(Also in this folder: `byline-relay.mjs`, the optional server. See the end.)*

Byline claims its credentials "verify anywhere else that reads the spec." That
claim is worthless if the only thing that has ever checked one is Byline's own
verifier — a quirk in the canonicalisation or the multicodec framing would sit
on both sides of the comparison and agree perfectly while being wrong.

So this verifies a Byline credential using no Byline code at all:

| what it tests | whose code does the testing |
| --- | --- |
| RFC 8785 canonicalisation | `canonicalize` |
| `did:key` resolution | `@digitalbazaar/did-method-key` |
| multibase / multicodec framing | `multiformats` |
| the `ecdsa-jcs-2019` proof | `@digitalbazaar/ecdsa-multikey` **and** `node:crypto` |

```bash
npm install && node verify.mjs && node verify-formats.mjs && node verify-oid4vp.mjs
```

`verify-oid4vp.mjs` takes a real OpenID4VP exchange — the signed request object
and the form body the wallet posted back — and checks it against the 1.0 final
spec: the request object's `typ`, that the request is signed by the key its
`client_id` names, that `vp_token` is keyed by the DCQL query id with array
values, and Appendix B's binding for `ldp_vc` (challenge is the nonce, domain is
the whole Client Identifier, proofPurpose is authentication). It then breaks the
nonce and the domain in turn to confirm each one actually invalidates the proof.
All 22 pass.

## The check that actually settles it

`verify-wallet.mjs` hands the same request and response to
**`@openid4vc/openid4vp`** — Animo's implementation, written against the same
spec, with no knowledge of Byline. Not a JOSE library confirming a signature is
well-formed: a wallet/verifier library deciding whether these are protocol
messages it would accept.

```bash
node verify-wallet.mjs
```

All 7 pass. The three worth naming:

- It **identifies the request as spec version 101** — OpenID4VP 1.0. A foreign
  implementation classifies Byline's output as conformant to the version it
  claims.
- Its validator **pairs the response with the request as type `dcql`**.
- Its DCQL reader, given only the `vp_token`, **finds `byline_delegation` and
  reads it as a W3C presentation** with `@context`, `type`, `holder`,
  `verifiableCredential` and `proof` — not as an opaque blob it can't interpret.

Note the division of labour, because it matters: this library validates
protocol *structure* and explicitly leaves verifying the presentations,
checking revocation and matching nonces to the caller. So structure is checked
by a foreign implementation; the cryptography is checked by `jose`,
`@digitalbazaar/ecdsa-multikey` and `node:crypto`. Neither alone would be
enough.

**A caveat about this file specifically.** The first run reported one failure
and one pass that was worthless: `parseDcqlVpToken` takes the token directly,
and I passed it an options object, which it treated as the token and echoed my
own keys back — a green check that tested nothing. Both were bugs in this
harness, not in Byline.

## Proving the harnesses can fail

```bash
node falsify.mjs
```

Sixty-seven green checks mean nothing until you know what would turn them red.
`falsify.mjs` breaks the evidence on purpose — twenty-seven mutations, one at a
time — and requires the check that claims to guard each one to stop saying PASS.

Each mutant is written to a temp directory and the harness is pointed at it with
`BYLINE_FIXTURE`, so the real fixtures are never touched and there is no restore
step to get wrong. A baseline run happens first, and a harness reporting zero
passes is treated as broken rather than agreeable — otherwise it would "catch"
every mutation by saying nothing.

**It found two hollow checks on the first run, both the same one.**
`verify-wallet.mjs` claimed *"their validator accepts the request payload —
client_id, response_type, nonce, dcql_query all acceptable to a foreign
implementation."* Mutation testing showed
`validateOpenid4vpAuthorizationRequestPayload` checks the Client Identifier and
essentially nothing else: a request with **no `dcql_query` at all**, or with
`response_type: "code"`, passed it unchanged. Three of those four claims were
decoration.

The repair was not to bump anything. The check now says only what that function
does, and the structural claims are made by schemas that genuinely
discriminate — `zClientIdPrefix`, `zCredentialFormat`,
`zOpenid4vpAuthorizationResponse` — each with a mutation proving it.

Two other changes came out of it: the harnesses now report a thrown exception as
a FAIL rather than dying before printing a verdict, and the version check
asserts 1.0 specifically instead of merely reporting whatever came back.

**27 mutations, 0 survivors.** Every one of the 67 checks has now been seen to
fail for the reason it claims to exist.

## And the same exercise on the app's own suite

```bash
node falsify-app.mjs      # writes 33 mutants of byline.html to ../_mutants/
```

Each mutant is the whole file with one load-bearing guard removed — the chain
stops linking to the previous entry, revocation always returns false, the
subset check on delegation is deleted, and so on. `byline.html?test=1&only=Group`
runs one slice of the suite, so a mutant takes seconds instead of a minute; the
mutants are driven in an iframe from the real page.

The generator refuses to write a mutant whose needle matches more than once, and
refuses a mutation aimed at a test group that does not exist. Both guards earned
their place immediately: one needle matched in two functions, and one group name
was wrong — which produced a run of nine unrelated tests that *looked* like a
survivor.

**18 mutations, 14 killed on the first pass, 4 survivors — all four real:**

| survived | why the suite missed it |
| --- | --- |
| the filing gate reads the card, not the credential | the test exercised `mayDo()`, the helper — nothing covered the line that consumes it |
| a request signed by a key other than `client_id` names | the test forged by rewriting the payload, so the *signature* check refused it first and the impersonation guard was never reached |
| a JWT with a bad signature | the test's "doctored payload" was invalid JSON, so `JSON.parse` refused it — that test would have passed with signature checking removed entirely |
| the multicodec header written wrong | the frozen vector always carries a correct header; nothing checked a freshly minted `did:key` |

Three of the four were tests **passing for the wrong reason**, which is the case
this exercise exists to find and the case no amount of re-reading the assertion
would have revealed. Four new tests now kill all four, and each was confirmed to
fail against its mutant before being called done.

### Round two: fifteen more guards

The first eighteen were the obvious ones. Round two went after the record walk,
the seals, redaction, anchoring, peer merging, the proposal queue, revocation,
and the passphrase lock — 33 mutants in total. **Five survived**, and two more
were reported killed when they had not been:

| survived | why |
| --- | --- |
| the chain hash no longer checked on walk | the "altering an entry" test changes `data`, which the *payload* hash catches first — the chain hash also covers `kind`, `ts` and the actor, and nothing altered those |
| the anchor count check removed | the truncation test lops the *newest* entries, which removes the anchored head and trips the head check; only removing an *older* entry reaches the count |
| a presentation naming one holder, signed by another | the stolen-credential test rewrites `holder` after signing, so the outer signature refuses it before the holder check is reached |
| `mergeLines` duplicating shared lines | nothing called it with an overlap |
| a sync clobbering the in-flight `busy` flag | the stored copy never carried `busy: false`, so `Object.assign` could not overwrite it and the guard was unreachable from that test |

The two false kills are the more instructive finding. Both Multiplayer mutants
"died" on the same crash — `Cannot read properties of undefined (reading
'push')`. Running the **unmutated** file on that group alone produced the same
crash. The test was order-dependent: in the full suite an earlier test had
always posted to that desk, so the message array existed; run on its own it did
not. A mutation "caught" by a crash the clean file also produces is not caught.
Every kill in this harness is now checked against a clean baseline of the same
group first.

Two more things went wrong in the harness itself before the results could be
trusted. A group name with a space in it (`'The record'`) was dropped by the
regex that listed valid groups, which aimed a mutation at three unrelated groups
and made a mis-aim look like a survivor. And three groups (Identity, Permissions)
never finished inside a hidden iframe — background throttling — while completing
in five seconds at top level; those run by navigation instead.

**33 mutations, 0 survivors** after five new tests, each confirmed red against
its mutant before green against the clean file.

`verify-formats.mjs` covers the three formats Byline gained *after* the first
check — presentations, VC-JWT and selective disclosure — because a format added
after the audit is a format nobody outside has read:

| what it tests | whose code does the testing |
| --- | --- |
| the VC-JWT envelope | `jose` |
| SD-JWT disclosure digests | `node:crypto`, recomputed from the spec |
| the presentation's proof | `canonicalize` + `node:crypto` |

All 19 pass. The two worth naming: `jose` — the JOSE implementation most of the
ecosystem uses — accepts Byline's VC-JWT against a key pulled from the `did:key`
alone; and the withheld claims in a selectively-disclosed credential are absent
from the wire when you search it both raw and base64url-decoded, rather than
merely absent from the parsed object.

All fifteen checks pass, including the two that matter most: digitalbazaar's
reference verifier accepts the proof, and Node verifies it having been given
nothing but the `did:key` string — no JWK, no public key file, no hint.

`byline-credentials.json` holds two credentials exported from a real workspace,
plus the exact canonical bytes Byline produced, so a mismatch shows you the
diff rather than just failing.

The canonical bytes and this signature are frozen into Byline's own test suite
(`byline.html?test=1`, under *Interop*). If Byline's implementation ever drifts
off the standard, that test fails at home rather than in someone else's verifier.

## The relay

Byline needs no server. When you want one, this is the whole of it:

```bash
node byline-relay.mjs 8126
```

Then in Byline: Settings → Masthead → Relay → `http://127.0.0.1:8126`. No
dependencies; state is in memory, and the two durable kinds are also written to
`_relay.json`.

| route | what it does |
| --- | --- |
| `POST /rooms/<code>/offer`, `GET /rooms/<code>/offer` | one side puts an invitation up under a room code; the other long-polls for it (up to 20s, then `204`) |
| `POST /rooms/<code>/answer`, `GET /rooms/<code>/answer` | the reply, the same way. A second offer or answer for a code is refused with `409`. Rooms last fifteen minutes |
| `PUT /status/<name>`, `GET /status/<name>` | hosts a signed `BitstringStatusListCredential`. Byline pushes on every withdrawal; a verifier anywhere fetches it |
| `PUT /did/<name>` → `GET /<name>/did.json` | hosts a DID document so `did:web:127.0.0.1%3A8126:<name>` resolves. The document must call itself by that name |

| `POST /deliver` | `{url, body}` — forwarded as a POST to the URL, if its host is in `BYLINE_RELAY_HOOKS`. The endpoint's status and first 2KB come back |

The relay hosts and carries. It does not verify anything, and it never sees the
masthead — after the two codes cross, the browsers talk directly.

Hardening is by environment variable, and `relay-test.mjs` drives each guard
from outside (11 checks: token, allowlist, scheme, rate):

```
BYLINE_RELAY_TOKEN=secret       PUT /status, PUT /did and POST /deliver need "authorization: Bearer secret"
BYLINE_RELAY_HOOKS=a.com,b:9000 hosts /deliver may forward to (default: none — delivery is off)
BYLINE_RELAY_RATE=120           requests a minute per address; a room-code guessing loop hits this first
```

```bash
node relay-test.mjs
```

## SD-JWT VC

`verify-sdjwt.mjs` reads a presentation Byline made — issuer JWT, one
disclosure, key-binding JWT — with `jose`, `multiformats` and `node:crypto`:
the issuer signature from the `did:key` alone, each disclosure against the
committed digests, the withheld claims absent from the wire, the binding
verified with `cnf.jwk`, its `sd_hash` recomputed over exactly what was
presented, and the audience and nonce it answers. 13 checks.

```bash
node verify-sdjwt.mjs
```

## ecdsa-rdfc-2019

`verify-rdfc.mjs` settles three things with `jsonld`, `rdf-canonize` and
`@digitalbazaar/vc` + `@digitalbazaar/ecdsa-rdfc-2019-cryptosuite`: that
Byline's canonical N-Quads for a credential and for its proof options are
byte-identical to the reference stack's; that a credential Byline signed under
the suite verifies there, given nothing but the `did:key`; and, with
`--issue`, it signs one with the reference stack and writes
`byline-rdfc-in.json`, which the in-browser suite freezes and verifies. 5
checks, 6 with `--issue`.

```bash
node verify-rdfc.mjs --issue
```

## OpenID4VCI

`verify-oid4vci.mjs` hands an issuance exchange Byline carried out with
itself to `@openid4vc/openid4vci` and `@openid4vc/oauth2`, with the
libraries' own `fetch` routed to the fixture. They read the offer link and
both well-known documents, send their own token request (compared with
Byline's), accept the token response, parse the credential request, verify the
`openid4vci-proof+jwt` for this issuer and nonce and refuse it for another,
and read the credential back. 9 checks.

```bash
node verify-oid4vci.mjs
```

## Preflight

`preflight.py` is the single gate before publishing: no CRLF, no NUL byte, one
inline script, the policy hash current, the script parses, the prose numbers
match the code, every engine on the machine, every harness here. `--quick`
skips the browsers and the harnesses.

```bash
python preflight.py
```

## The policy hash

`csp-hash.py` stamps the SHA-256 of `byline.html`'s one inline script into its
Content-Security-Policy. Run it after any edit to the file; `--check` exits
non-zero if the hash on file is stale. A stale hash stops the application from
running at all, which is the intended failure.

```bash
curl -s http://127.0.0.1:8126/status/community | node -e '
  let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{const v=JSON.parse(s);
  console.log(v.type, v.issuer, v.credentialSubject.encodedList.slice(0,24)+"…")})'
```
