# Third-party material

Byline's own code is Apache 2.0. Two things in this repository are not Byline's.

## @noble/secp256k1 3.2.0 — inside `byline.html`

The browser's WebCrypto cannot sign with secp256k1, the curve Nostr and Buzz
use, so the bridge to Buzz vendors this library. It sits between the markers
`/* ==== vendored: @noble/secp256k1` and `/* ==== end vendored ==== */`, wrapped
in a function so only what the bridge uses escapes.

- Source: https://github.com/paulmillr/noble-secp256k1 — `index.js` of the npm
  package, SHA-256 `ba5aadb469e9208f2da1c9878ab6bb93d2c894f84e6c7ebf9dbf9462741b9fb7`
- Changes: the two `export` statements replaced by a `return`; nothing else.
- Its author states that this version has not been independently audited (the
  v1 it rewrites was, by Cure53, in 2021). It is therefore checked rather than
  trusted: against all nineteen BIP-340 vectors in the browser suite, and
  against libsecp256k1 in `interop/verify-nipoa.py`.
- To update: re-vendor, re-hash, re-run both checks.

```
The MIT License (MIT)

Copyright (c) 2019 Paul Miller (https://paulmillr.com)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the “Software”), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

## BIP-340 test vectors — `interop/vectors/bip340.csv`, and inside the test suite

From https://github.com/bitcoin/bips (`bip-0340/test-vectors.csv`), licensed
BSD-2-Clause OR MIT OR CC0-1.0 per the BIP's `License-Code` header. Unmodified.

## NIP-OA test vector — inside the test suite and `interop/verify-nipoa.py`

The owner-attestation vector and signed example come from Block's Buzz
(`docs/nips/NIP-OA.md`, Apache 2.0): https://github.com/block/buzz

## Harness dependencies — `interop/package.json`

The verification harnesses use other people's libraries on purpose; that is
what makes them evidence. They are development dependencies, restored by
`npm ci`, and none of them ships in `byline.html`.
