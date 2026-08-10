# Universal Beam — handover

> **Update 2026-08-10 — the pairing QR is now UNI·SIM branded, and its scan is
> mechanised.** `BrandedQr.tsx` renders the same arrangement Universal QR ships
> as its default (rounded #1c1917 modules, #e05504 finder eyes, EC 'H', the
> mark in the centre — mirrored from `Universal_QR/src/lib/qr.ts`
> DEFAULT_CONFIG, where every one of those choices was measured, not styled).
> `qrcode.react` is gone; `qr-code-styling` renders it as SVG. The centre image
> is the `public/unisim-icon.png` the navbar already loads — no inlined data
> URI. ⚠️ Branding is exactly how a QR stops scanning (Universal QR's first
> branded default was unscannable by its own scan tab), so `e2e/qr.e2e.ts`
> screenshots the real rendered pixels at the real 160 px size and decodes them
> with strict zxing, on first paint and again after "Start a new code". Restyle
> nothing without keeping that spec green.

> **Update 2026-08-10 — v2 (files) is built and shipped.** §4.8 below is done:
> chunked transfer over the same channel with real backpressure, stream-to-disk
> on Chrome/Edge, memory + download elsewhere with the ceiling stated on the
> offer row, accept/decline/cancel from either end, and the §13.3 SAS safety
> number (which §4 flagged as "before the file leg ships"). Proven by e2e: 8 MB
> of random bytes crossed two real browser contexts hash-identical. Protocol
> details: the header comment of `src/lib/files.ts`. The cross-network and
> Firefox/Safari caveats in §1 still stand — now for files too.

**State: v1 (text) is built, compiles, lints, and has been proven working
browser-to-browser. Not deployed. No GitHub remote. Local commits only.**
*(Superseded — deployed 2026-08-06, and v2 files shipped 2026-08-10; see above.)*

Written 2026-08-05, at the end of the session that finished the app a previous
session had drafted but never run.

---

## 1. What was proved live, and what was only compiled

This distinction matters more than usual here, because the previous session left
behind ~1,300 lines of confident, heavily-commented WebRTC code that **had never
been executed once**. It turned out to be largely correct — but "largely" was
not knowable until it ran.

### Proved live, on this machine, against the real production rendezvous

Run `npm run test:e2e` to repeat any of it.

- **Two isolated browser contexts pair by code** through
  `wss://opensource.unisim.co.uk/rtc/room` and open an `RTCDataChannel`.
  Measured time from second device landing to `connected`: **~0.8 s** on one
  LAN.
- **Text crosses, both directions.** A→B and B→A, including multi-line text with
  blank lines and doubled spaces, and a URL that arrives intact and is offered
  as a link.
- **The route was `host ↔ host`** — the browsers connected over the local
  network. Both ends reported *"Direct — over your local network"*, and the test
  asserts the route is never `relay`.
- **The rendezvous socket really does close** ~4 s after the channel opens, and
  text still flows afterwards. Asserted by counting `/rtc/room` WebSocket opens
  and closes from outside the app. This is the product claim, mechanised.
- **The direct-or-fail path produces a sentence, not a spinner.** Forced with
  `iceTransportPolicy: 'relay'` against a TURN server that does not exist, so
  neither browser gathers a usable candidate and ICE genuinely fails. Nothing in
  the app is stubbed — only the network. The failure card appears within the
  20 s watchdog with a headline, an explanation, suggested fixes, and copyable
  technical evidence.
- **Light mode holds** even in a context whose `prefers-color-scheme` is dark.
- **The banned marketing sentences are absent** from the rendered page, and
  *"both devices need the internet"* is present.
- `/rtc/turn` was probed directly: it returns
  `{"iceServers":[{"urls":["stun:stun.cloudflare.com:3478"]}]}` — **STUN only.
  TURN is not configured in production.** §13.2's open question Q1 ("was it ever
  configured?") is answered: no.

### Compiled and reviewed, but NOT exercised

- **Every failure branch except the one the e2e test forces.** `diagnose()` has
  unit tests covering all five branches with synthesised evidence, but only the
  "no usable candidates" branch has been driven by a real browser. The
  symmetric-NAT branch in particular has never fired on a real network — by
  construction, since I cannot produce a symmetric NAT here.
- **Cross-network pairing.** Every live pairing in this session was two contexts
  on one machine. Two devices on genuinely different networks (the case the STUN
  path exists for) has not been tested. This is the single biggest untested
  thing, and it is the one only you can do.
- **Any browser except Chromium.** Firefox and Safari are untested. `rtc.ts` has
  a Firefox-specific fallback in `reportRoute()` (Firefox does not always publish
  `transport.selectedCandidatePairId`) that has never run.
- **Mobile.** Layout is responsive and was eyeballed at desktop width only. No
  device, no emulator.
- **The QR code as a QR code.** It renders and encodes the right URL, but nothing
  has scanned it with a camera.
- **The room's 10-minute TTL and the transparent re-join.** `rtc.ts` re-joins
  when the socket closes while still `waiting`. No test waits ten minutes.
- **PWA / offline shell.** The service worker builds; installation was not
  tested. Note the shell going offline does not make the *product* work offline
  — pairing always needs the network.
- **Signed-in behaviour.** `UsageTracker` is mounted with `product: 'beam'`, but
  every live run was anonymous, so no `usage_events` row has actually been
  inserted. See §4.

## 2. The honest expected failure rate

Direct-or-fail means a real, non-zero slice of attempts cannot succeed. The
numbers, separated because they get conflated:

| Case | Expected failure rate | Why |
|---|---|---|
| **Both devices on the same Wi-Fi** | **~0%** | ICE host candidates connect directly. No STUN needed, no NAT to traverse. This is the primary use case and it is the one measured above. |
| **Different networks, home broadband both ends** | **roughly 5–15%** | Published WebRTC operator figures put TURN-relayed sessions at ~10–20% of connections across general populations; home broadband sits at the better end. Without TURN, that percentage becomes outright failure, not degradation. |
| **Mobile carrier, or corporate/guest Wi-Fi on either end** | **materially worse — plausibly 20–35%** | Carrier-grade NAT is frequently symmetric; corporate networks block UDP outright. Both are exactly what defeats STUN-only traversal. |
| **VPN on either end** | Elevated, unquantified | Common enough that it is named in the failure card's suggestions. |

**Do not quote a precise figure in marketing copy.** Our own number is
unmeasured, and it will skew low relative to published figures because our
intended population is disproportionately same-LAN. Equally, do not describe it
as negligible: on a phone on 4G to a laptop behind a corporate firewall, failure
is the likely outcome, not the edge case.

The mitigation is not TURN, it is the failure card. It names the cause and
suggests the fix that works nearly every time (same Wi-Fi / a personal hotspot).

## 3. What in §13 turned out wrong or incomplete

§13 of `Docs_UNI_SIM/next-products.md` held up well. Corrections:

1. **The premise that `webrtc-spike.html` "is most of v1, already written" is
   optimistic.** The spike is ~200 lines and proves the concept; it has no
   tie-break, no re-join, no candidate queueing before `setRemoteDescription`,
   no route reporting, no failure diagnosis and no UI. The finished session
   layer is ~520 lines and the diagnosis layer another ~200. The spike was the
   right thing to start from and the right thing to stop copying early.
2. **§13.2's "TURN endpoint exists but the service may not" is now settled.**
   Probed live: STUN only. There is no ambiguity left to plan around.
3. **§13.5's "integration cost is one line each" is right but incomplete.** The
   SDK also needs a `DEFAULT_UNIVERSAL_APPS_PRODUCTS` entry or the navbar
   renders the product icon with **no name beside it** — the name comes from
   the catalogue, not from `productLogo`. Worked around locally in
   `src/lib/catalogue.tsx`; see §4.
4. **§13.6's enum landmine is closed, not open.** `beam` is in the Postgres
   enum, in `ProductCode`, in `SuiteProductId` and in the provider's
   `UNIVERSAL_APP_PRODUCTS`, shipped in `@unisim/sdk` 0.85.0. `main.tsx` writes
   `product: 'beam'` with **no cast**, which is the whole point.
5. **A bug §13 did not anticipate, found by a unit test I wrote to check
   something else:** naive normalisation of a pasted **join link** produces
   `HTTPSOPE` — eight characters that pass the code validator, that the
   rendezvous Worker accepts, and that will sit in an empty room forever. Since
   the app hands users a "Copy the link" button, pasting that link into the code
   box is a *likely* action, and it produced precisely the silent unexplainable
   failure this product cannot afford. `normaliseCode()` now extracts `?c=` from
   a URL, and returns `''` for a link with no code rather than inventing one.
   There is a regression test.
6. **A UI dead end the failure e2e test found:** the first cut replaced the
   pairing card with the failure card, leaving the user reading *"put both
   devices on the same Wi-Fi and try again"* with no code, no QR and no join box
   to try again *with*. The failure card now sits **above** a pairing card that
   stays.

## 4. What is left for you

**Nothing here is blocking; the app works. These are the go-live items.**

1. **Test it across two real networks and two real devices.** Phone on mobile
   data, laptop on Wi-Fi. This is the case no amount of local testing reaches,
   and it is the one that tells you whether the failure copy is right in the
   wild.
2. **Firefox and Safari.** Especially Safari — the `reportRoute()` stats path
   and `getUserMedia`-free data channels are the likely rough edges.
3. **Add `beam` to the SDK's `DEFAULT_UNIVERSAL_APPS_PRODUCTS`** (with a glyph
   and `category: 'everyday'`), then **delete `src/lib/catalogue.tsx`** and drop
   the `products` prop from `App.tsx`. The shim exists only because that entry
   is missing; it has a clean exit and the file says so.
4. **Deploy.** Not done, deliberately — no Cloudflare Pages project, no remote,
   no push. It needs: a Pages project, a `TARGETS` entry for `/beam` in
   `backoffice/opensource-portal/src/worker.js`, and a tile in the portal's
   `public/index.html`. `public/_redirects` and `base: '/beam/'` are already
   written for it.
5. **Decide about the room TTL.** §13.2 asks for the Durable Object's alarm to
   become idle-based. I did **not** touch `opensource-portal` (out of scope this
   session), so instead the client re-joins transparently while waiting. That
   covers the "code left on screen" case without a server change. If you would
   rather fix it properly in the DO, the client-side re-join can then be
   simplified — but it is harmless either way.
6. **A `UNISIM_Compare` entry** (§13.7). `features.encrypted: true` is honestly
   claimable here, which no other app in this space in the suite can say. The
   matrix must carry the rows we lose — *"works with no internet"* to LocalSend,
   *"automatically finds nearby devices"* to PairDrop and AirDrop.
7. **Verify a signed-in visit actually inserts a `usage_events` row.** The enum
   value exists, but no live run in this session was signed in, so the insert
   path is unproven end to end. It is a two-minute check and it is exactly the
   check that was skipped for Converter and USB.
8. **v2: files.** Chunked over the same channel, real backpressure
   (`bufferedAmountLowThreshold`), and — the actual trap — **stream to disk on
   the receive side**, not a `Blob` in RAM. Chrome/Edge have
   `showSaveFilePicker`; Safari and Firefox do not, and their practical ceiling
   is available RAM. State the per-browser ceiling in the UI before someone
   discovers it at 94% of a 3 GB file.

## 5. Landmines specific to this repo

- **Do not add a relay fallback for text "because it's cheap".** It is cheap,
  and it would work. It would also make *"no server ever holds your text"* false
  on a path the app can take, and a privacy claim with an asterisk is worth less
  than the feature it buys. This was decided; it is not an oversight.
- **Never write `as unknown as ProductCode`.** `SuiteProductId` ends in
  `| (string & {})`, so a wrong product code type-checks. That cast is what let
  Converter and USB lose every usage event from launch.
- **`/rtc/*`, never `/screens/*`.** They are the same Durable Object namespace
  and a peer on either path pairs with a peer on the other — but `/screens/*` is
  frozen for shipped native binaries that hardcode it. Beam is the first `/rtc`
  consumer.
- **`initFromUrl()` is idempotent on purpose.** Without the guard, React
  StrictMode's double-invoked mount effect opens a second socket on the same
  code; the room caps at two peers, so the app fills its own room and the real
  peer gets `409 room full`. It only happens in dev and looks exactly like a
  network fault.
- **The dev-console CORS error on `/rtc/turn` is expected**, because in dev the
  app is cross-origin to the Worker and that endpoint sets no CORS headers. It
  falls back to the same public STUN server the endpoint would have returned.
  Do not "fix" it in `opensource-portal`.
