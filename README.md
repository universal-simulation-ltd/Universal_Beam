# Universal Beam

**Send text straight between your devices.** Pair two browsers with a short
code, then type or paste — notes, links, snippets. It goes device to device over
a WebRTC data channel, encrypted end to end by the browser, and **no server ever
holds a word of it**.

Part of the [UNI·SIM Universal Apps](https://opensource.unisim.co.uk) — free,
open source, no account required. Served at
`opensource.unisim.co.uk/beam`.

---

## What it is, in one diagram

```
  browser A ──wss──┐                     ┌──wss── browser B
                   ├─ rendezvous room ───┤        (a Durable Object in
                   │  (SDP + ICE only)   │         backoffice/opensource-portal,
  browser A ═══════╪══ RTCDataChannel ═══╪═══════  one instance per code)
                   │      (your text)    │
```

The rendezvous carries the negotiation and nothing else. Once the data channel
opens, Beam **closes the WebSocket** — so the server is not merely trusted to
stay out of the payload path, it is removed from it. There is an end-to-end test
that asserts exactly that ([`e2e/beam.spec.ts`](e2e/beam.spec.ts)).

## What it deliberately cannot do

These are on the page in the app itself, not just here. Each is a browser limit
or a deliberate trade, and each has bitten someone who assumed otherwise.

| | |
|---|---|
| **Works offline** | ❌ **No.** Two devices on the same Wi-Fi *still need the internet to pair.* A browser tab cannot browse mDNS and cannot join a multicast group — there is no web API for either — so it cannot discover anything on your LAN. If you need transfers with no internet at all, use **[LocalSend](https://localsend.org)**; it is free, and it is better at that than a web page can be. |
| **Finds nearby devices automatically** | ❌ No. Explicit code + QR only. The Snapdrop/PairDrop model buckets sockets by public IP, which shows strangers to each other on carrier-grade NAT and cannot work across networks at all. |
| **Mirrors your clipboard** | ❌ No, and it never will. `navigator.clipboard.readText()` does not exist in Firefox and is permission- plus gesture-gated elsewhere. Sending is always something you press. |
| **Falls back to a relay when direct fails** | ❌ No — **direct-or-fail**. There is no paid TURN. Where a network blocks peer-to-peer, Beam says so in plain words with a reason and something to try (see `src/lib/diagnose.ts`). A silent spinner is the worst possible outcome for this product. |
| **Remembers anything** | ❌ No account, no history, no sync, no "send to a device that's switched off". Closing the tab is the delete button. |
| **Sends files** | Not yet — v1 is text. Files are v2, over the same channel. |

**Sentences that must never appear in this app's copy** (each is false on a leg
the product actually supports): *"never leaves your network"*, *"no servers
involved"*, *"works offline"*. There is an e2e test asserting the page does not
contain them.

## Develop

```bash
cd D:/Github/UNISIM/Universal_Apps/Universal_Beam    # macOS: ~/Github/UNISIM/...
npm install
./scripts/preview.sh        # or  .\scripts\preview.ps1   on Windows
```

Port **5197**, reserved for Beam in `Docs_UNI_SIM/dev-preview.md`. The scripts
pass `--strictPort`, so a clash fails loudly rather than serving Beam on another
app's port.

> **Pairing needs the internet even in dev.** The dev server serves the UI, but
> the two tabs still find each other through the live rendezvous at
> `opensource.unisim.co.uk/rtc/room`. Point that elsewhere with
> `VITE_RENDEZVOUS_ORIGIN` (e.g. a local `wrangler dev` of `opensource-portal`).

> **A red CORS error in the dev console is expected.** `/rtc/turn` sets no CORS
> headers, and in dev the app is cross-origin to it. The fetch fails, Beam falls
> back to public STUN — which is exactly what that endpoint returns today — so
> dev and prod behave identically. Do not "fix" it in `opensource-portal`.

| Command | Does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | `tsc -b` then a production bundle into `dist/` |
| `npm run lint` | ESLint (flat config, typescript-eslint) |
| `npm test` | Vitest — the pure logic (code minting, failure diagnosis) |
| `npm run test:e2e` | **Playwright — two real browsers, the real rendezvous, real text over a real data channel.** Needs an internet connection. |

`npm run test:e2e` is the one that matters. Everything else can be green while
the product does not work.

## Architecture

| File | Job |
|---|---|
| `src/lib/rtc.ts` | `BeamSession` — joins the room, tie-breaks who offers, runs ICE, opens the data channel, hangs up on the rendezvous, diagnoses failure. |
| `src/lib/code.ts` | Mints the pairing code. **The code is the only authentication this product has** — 6 glyphs from a 32-glyph alphabet via `crypto.getRandomValues` (2³⁰ ≈ 1.07 billion), never `Math.random()`. |
| `src/lib/diagnose.ts` | Turns collected ICE evidence into a sentence a person can act on. |
| `src/lib/clipboard.ts` | Copy/paste, and the honest limits of both. |
| `src/stores/beamStore.ts` | Zustand store; owns the one live `BeamSession`. |
| `src/components/` | UI. `PairCard` (code + QR + join), `Room` (composer + session), `FailureCard`, `Honesty`. |

### The pairing protocol

Room control frames from the Durable Object carry `type`
(`waiting` / `paired` / `peer-left`); everything a *peer* sends carries `t`
(`hello` / `sdp` / `ice`) and is relayed verbatim. Keeping those namespaces
apart is the difference between "the room told me my peer left" and "my peer
sent me the word `peer-left`".

Who makes the offer is decided by a random 32-bit nonce exchanged in `hello`,
**not** by the `role` in the URL — because a user can open the same join link on
both devices, and two "guests" would otherwise wait for each other forever.

## Security

- **The room code is the lock.** The rendezvous authenticates nobody; whoever
  joins first becomes your peer, and your browser will faithfully verify the
  DTLS fingerprint *they* published. The code is minted with
  `crypto.getRandomValues` and is 6 characters for that reason.
- **The room caps at two peers**, so an attacker must win a race to be second,
  not merely guess eventually.
- **DTLS is mandatory-to-use in WebRTC.** The data channel is encrypted whether
  or not we do anything, with per-session keys.
- Not done yet: a short verification string derived from both DTLS
  fingerprints (the SAS pattern). Worth doing before the file leg ships.

## Licence

MIT — see [LICENSE](LICENSE).
