# Byline and Buzz — comparison, rating, audit

2026-09-11. Buzz facts come from its own repository and Block's posts (sources at the end); Byline facts come from this repository, and every number was measured this round.

## In one paragraph

Buzz is Block's open-source workspace for people and AI agents: a Rust Nostr relay with a desktop app, real coding agents, git hosting and search. It has a funded team behind it and 32.5K stars. Byline began as a single-file copy of Buzz and has since become something narrower and deeper — a trust layer that happens to have a newsroom around it. Buzz is far ahead on everything a team would use on Monday. Byline is ahead on one thing: how an agent's authority is written down and checked without trusting the operator. Block shipping the same thesis at scale is the best evidence yet that the thesis is right. It is also a clear signal that the workspace itself belongs to Block, and that Byline's potential lies in the layer underneath it.

## Compare and contrast

| | Buzz | Byline |
|---|---|---|
| Shape | Rust relay (Axum) on Postgres and Redis; Tauri desktop app; `buzz-cli`; Flutter mobile unfinished | One HTML file, 790 KB, no server required; WebRTC between browsers; an optional small relay on loopback |
| Source of truth | The relay — "no peer-to-peer event exchange, no gossip, no replication" | Each browser; peers sync only the shared record, and each keeps the other's record as a second witness |
| Keys | Nostr, secp256k1 BIP-340 Schnorr | WebCrypto P-256 ECDSA, with `did:key` and `did:web` identifiers |
| Agent ↔ owner link | NIP-OA: the owner signs `nostr:agent-auth:<agent>:<conditions>`, where conditions are only `kind=` and `created_at` bounds; the tag is a reusable capability | A W3C credential naming scopes (file, delegate, …), an audience and an expiry; sub-delegation only to a strict subset; depth capped; checked on every act |
| Revocation | NIP-AA: revoke the owner's relay membership and the agent's next connection fails — state held by the relay | BitstringStatusList that any verifier fetches, hosted or local; the whole chain beneath a withdrawn credential falls with it |
| Key rotation and recovery | None in the docs read; VISION_SOVEREIGN says plainly "there is no account recovery" | A signed handover that both keys agree to; the next key committed in the record in advance; a recovery file |
| Record | `buzz-audit`: a SHA-256 hash chain kept by the server, one per community | A hash chain in which each link is also sealed by the actor's own key; anchors kept outside the browser; entries redactable without breaking the chain |
| Approvals | A `request_approval` workflow step exists, but runs that reach it are marked Failed (WF-08, unfinished) | Working: a draft waits as a proposal until a person releases it, and a 👍 publishes only if the reaction is signed by the right key |
| Real agents | Yes — Claude Code, Codex and goose through ACP | No — the harnesses are labels; only a local model or the Anthropic API actually runs |
| Workflows | YAML, with message, reaction, schedule and webhook triggers | YAML, with the same four triggers |
| Git, search, media, huddles | Git hosting (NIP-34; storage model-checked in TLA+), Postgres full-text search, media with frame comments, voice | Search over desks; no git; voice written but never heard |
| Standards reach | The Nostr ecosystem | W3C VC (ecdsa-jcs-2019 and ecdsa-rdfc-2019), VC-JWT, SD-JWT VC, OpenID4VP 1.0, OpenID4VCI, and now NIP-OA toward Buzz — each checked against someone else's code |
| Testing | Unit and integration tests, 134 end-to-end tests, Playwright, clippy; the TESTING.md rule "a guard whose removal doesn't fail any test protects nothing" | 177 in-browser tests in two engines and at a phone-sized window; 95 checks against outside reference libraries, plus 196 against libsecp256k1 for the Buzz bridge; 25 relay checks; every guard added this session was mutation-tested |
| Scale and maturity | v0.4.x; 32.5K stars, 4.3K forks, 3.5K open issues; Apache 2.0; Block behind it | A prototype built by one person; never used by a team |

**Where Buzz is simply better:** everything operational. It also has one structural advantage. A single relay that verifies every event avoids the whole class of bugs that has cost Byline the most: its peer-to-peer merge produced four real defects in the last four passes.

**Where Byline says something Buzz does not:** an agent's authority that a third party can read and check from the credential alone, including scope, expiry, sub-delegation and revocation; a key lifecycle with an honest story for rotation and compromise; a record sealed by its authors rather than kept by its operator; and approval gates that work.

## Rating

The same three lenses as every round.

| Lens | Last | Now | Why |
|---|---|---|---|
| As a prototype | 8.5 | **8.5, holding** | This round's new directions — an outside threat model, a comparison with Buzz, and an audit of every HTML sink — found four real defect classes: secrets sent to a peer, settings overwritten by a peer, the record replaced by a peer, and markup injected through identifiers. All four are fixed, and each fix was proven by a test that failed first and by mutations. That the process works is creditable. That those defects existed means the claims were not all tested, so the rating holds rather than rises. |
| Monday-usable | 3 | **3, holding** | Nothing changed about whether a team could rely on it: correspondents still stop when a laptop closes, there are still at most two peers, a real authenticator has never been tried, and no stranger has used it. |
| Potential | 8.5 | **9** | New evidence from outside: Block independently shipped the same thesis — agents as members with their own keys, owner-signed authorisation, a signed log — and Buzz's trust layer is thinnest exactly where Byline's is strongest. The thesis is right, and the trust layer stands on its own. The same evidence says the workspace does not: the potential lies in the layer underneath, not in a competing app. |

## Audit this round

**Markup through an identifier or a colour — found and fixed.** Text was always escaped before it was drawn. Identifiers and colours went into HTML attributes as they came, because this file originally made them all. Since peers began sharing desks, lines and people, several of those values are the peer's to choose. Measured against the unfixed code, one hostile snapshot plus one line put **eleven elements the peer wrote** into the page. A reaction could be markup outright: the emoji was drawn raw, both inside the attribute and as the button's text.

The CSP stopped any of it running script. It did not stop it drawing a false "verified" chip or a link. Two layers now close it:
- **Where data arrives.** A snapshot, a stored masthead and an imported file all pass through `hydrate`; peer lines and reactions are checked separately. Identifiers are held to `SAFE_ID`, colours to `SAFE_COLOR`, and reactions to `okEmoji`.
- **Where it lands.** Every inserted identifier is escaped (37 attribute sites found by pattern, plus the compound ones in the quick-reaction toolbar and search results), and every colour passes through `safeColor`.

The test also plants hostile values directly in memory, bypassing every entry point, so each layer is tested on its own. The first run of that check found four elements the pattern sweep had missed: the quick-reaction toolbar. Two selectors built from identifiers now use `CSS.escape`, so a hostile id cannot crash a render.

**Reintroduction guard.** The test that counts the old product name in the source caught it once this round — in a comment of mine.

**Still open from the threat model:** nothing without a stated residual. What remains is listed in THREAT-MODEL.md: certificate grinding against the code comparison, a person who keeps declining the lock, a revocation's own date, names that resolve privately, and the choice to let a live model file directly.

## Improvements

**Made this round:**
- Buzz names removed, with a migration.
- TM-001, TM-002 and TM-012 fixed.
- Identifier and colour injection fixed.

All are recorded in the README with their failing-first tests.

**Done since — all five, each test-first:**
1. **Peers compare a code (TM-004).** Eight digits from both DTLS fingerprints are shown on each screen, and nothing syncs until the person confirms them. This brings Buzz's one structural advantage, knowing who is on the line, into a design with no server.
2. **Authority roots are a decision (TM-005).** A person a peer introduces is foreign until the owner says otherwise.
3. **Secrets go under the lock, and the lock is offered at onboarding (TM-003).** It is still optional.
4. **An import says what it will change (TM-007).**
5. **The trust layer reaches Buzz.** A correspondent's delegation exports as a NIP-OA owner attestation, from a Nostr key derived from the byline key. It is checked against BIP-340's vectors, against Buzz's own published NIP-OA vector, and against libsecp256k1 in both directions. It carries only what NIP-OA can: kind and time. Named scopes, sub-delegation and withdrawal stay on Byline's side.

**The ratings hold at 8.5, 3 and 9.** This round closed gaps the comparison had already named. It did not bring evidence from a new direction, which is what moves them. The bridge is the first thing that would let someone outside test that: a Buzz user checking a Byline-issued tag.

## Sources

- [block/buzz](https://github.com/block/buzz): README, ARCHITECTURE.md, NOSTR.md, SECURITY.md, TESTING.md, VISION_SOVEREIGN.md, VISION_REMOTE_AGENTS.md, `docs/nips/NIP-OA.md`, `docs/nips/NIP-AA.md`
- [Buzz! — Block Engineering Blog](https://engineering.block.xyz/blog/buzz)
- [Block launches Buzz — SiliconANGLE](https://siliconangle.com/2026/07/21/block-launches-buzz-open-source-workspace-humans-ai-agents/)
- [buzz.xyz](https://buzz.xyz)
