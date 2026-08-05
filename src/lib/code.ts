// The pairing code — the ONLY authentication this product has.
//
// Read that sentence again before changing anything here. The rendezvous
// Durable Object authenticates nobody: whoever joins the room first becomes
// your peer, and the DTLS fingerprint they publish is the one your browser
// faithfully verifies against. WebRTC's encryption is excellent and completely
// beside the point if a stranger is on the other end. The code IS the lock.
//
// Two things follow, and the Screens spike gets both wrong (see
// opensource-portal/public/screens/webrtc-spike.html:81 and receive.html:92):
//
//   1. Math.random() is a non-cryptographic PRNG. Its output is predictable
//      from a handful of prior samples. Never mint a credential with it.
//   2. Four characters is not enough. The spike's 4 digits are 9,000 values.
//
// What we do instead: 6 characters from a 32-glyph alphabet drawn with
// crypto.getRandomValues — 32^6 = 1,073,741,824 codes.
//
// Why 32 glyphs exactly, and not 31 or 36: 256 / 32 = 8 with no remainder, so
// every byte maps to a glyph with NO modulo bias and no rejection loop. A
// 31-glyph alphabet would need `% 31`, which makes the first 8 glyphs very
// slightly more likely — irrelevant in practice, but "very slightly biased" is
// a strange thing to choose when unbiased is free.
//
// The alphabet drops I, O, 0 and 1 because a human reads this code aloud down a
// phone line or types it off a screen. It is uppercase because the Worker
// upper-cases and validates /^[A-Z0-9]{4,8}$/ (see opensource-portal
// src/worker.js → serveRendezvous), so a lowercase code would be rejected.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 6

export function mintCode(): string {
  const bytes = new Uint8Array(CODE_LENGTH)
  crypto.getRandomValues(bytes)
  let out = ''
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length]
  return out
}

/** Normalise anything a human typed or pasted into a candidate code.
 *
 * ⚠️ The URL branch is not a nicety, it is a bug fix. People paste the whole
 * join link into the code box — it is the thing we hand them a "Copy the link"
 * button for. Stripping punctuation from
 * `https://opensource.unisim.co.uk/beam/?c=ABC234` yields `HTTPSOPE`: eight
 * characters that pass isValidCode(), that the rendezvous Worker cheerfully
 * accepts, and that will therefore sit in an empty room forever. A silent,
 * unexplainable pairing failure is the single worst outcome for this product,
 * and this is the cheapest place one could have come from. */
export function normaliseCode(raw: string): string {
  const input = raw.trim()
  if (/^https?:\/\//i.test(input)) {
    // A link: the code is the `c` query parameter or there isn't one. Returning
    // '' keeps the Connect button disabled, which is honest — better than
    // manufacturing a plausible code out of the hostname.
    return clean(/[?&]c=([A-Za-z0-9]+)/.exec(input)?.[1] ?? '')
  }
  return clean(input)
}

function clean(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)
}

/** Does this match what the rendezvous Worker will accept? */
export function isValidCode(code: string): boolean {
  return /^[A-Z0-9]{4,8}$/.test(code)
}
