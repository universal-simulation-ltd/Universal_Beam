// The safety check — a short number derived from both ends' DTLS fingerprints.
//
// The room code is the only authentication Beam has: whoever joins the room
// second becomes your peer, and your browser will faithfully encrypt to
// WHOEVER that is. DTLS guarantees nobody in the middle can read the channel;
// it does not guarantee the far end is your other device rather than a
// rendezvous server playing both sides. The classic answer is a Short
// Authentication String: both ends derive a number from the two certificate
// fingerprints exchanged in the SDP, and a human glances at both screens. A
// man in the middle runs TWO DTLS sessions with two different certificates,
// so the two screens cannot show the same number.
//
// Display-only, never enforced — the value is a check a person CAN make, not
// a gate. §13.3 of next-products.md costs this at an afternoon and calls it
// what makes "end-to-end encrypted" defensible against a malicious
// signalling server rather than merely true in the happy path.

/** Pull the certificate fingerprint (`a=fingerprint:sha-256 AB:CD:…`) out of
 *  an SDP blob. Returns null when there isn't one — never invent a value. */
export function extractFingerprint(sdp: string | undefined | null): string | null {
  if (!sdp) return null
  const m = /^a=fingerprint:\S+\s+([0-9A-F:]{47,})\s*$/im.exec(sdp)
  return m ? m[1].toUpperCase() : null
}

/** Derive the six-digit safety number from the two fingerprints.
 *
 *  Sorted before hashing so both ends compute the identical value — each side
 *  sees the same two certificates but disagrees about which one is "local".
 *  Six decimal digits ≈ 20 bits: not enough to stop a brute-force search of
 *  the *code space*, but that is not the attack — a MITM would need a DTLS
 *  certificate whose fingerprint collides into the same 6 digits against a
 *  fixed partner, live, during one pairing. (The 2³² → 10⁶ modulo bias is
 *  ~0.03% and irrelevant at display strength.) */
export async function deriveSas(fpA: string, fpB: string): Promise<string> {
  const material = [fpA, fpB].sort().join('|')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material))
  const view = new DataView(digest)
  const n = view.getUint32(0, false) % 1_000_000
  const s = String(n).padStart(6, '0')
  return `${s.slice(0, 3)} ${s.slice(3)}`
}
