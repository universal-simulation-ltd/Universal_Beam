import { describe, expect, it } from 'vitest'
import { deriveSas, extractFingerprint } from './sas'

const FP_A = '7B:8B:F0:65:5F:78:E2:51:3B:AC:6F:F3:3F:46:1B:35:DC:B8:5F:64:1A:24:C2:43:F0:A1:58:D0:A1:2C:19:08'
const FP_B = '4A:AD:B9:B1:3F:82:18:3B:54:02:12:DF:3E:5D:49:6B:19:E5:7C:AB:5A:1D:6E:A2:8D:1F:AC:C9:F4:37:C4:5A'

const SDP_SAMPLE = [
  'v=0',
  'o=- 46117317 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
  'c=IN IP4 0.0.0.0',
  `a=fingerprint:sha-256 ${FP_A}`,
  'a=setup:actpass',
  'a=mid:0',
].join('\r\n')

describe('extractFingerprint', () => {
  it('pulls the fingerprint out of a real SDP shape', () => {
    expect(extractFingerprint(SDP_SAMPLE)).toBe(FP_A)
  })

  it('is case-insensitive on the attribute and normalises the hex to upper', () => {
    const lower = SDP_SAMPLE.replace(`a=fingerprint:sha-256 ${FP_A}`, `a=fingerprint:SHA-256 ${FP_A.toLowerCase()}`)
    expect(extractFingerprint(lower)).toBe(FP_A)
  })

  it('returns null rather than inventing a value', () => {
    expect(extractFingerprint(undefined)).toBeNull()
    expect(extractFingerprint('')).toBeNull()
    expect(extractFingerprint('v=0\r\ns=-')).toBeNull()
    // Too short to be a real digest — a truncated line must not half-match.
    expect(extractFingerprint('a=fingerprint:sha-256 AB:CD')).toBeNull()
  })
})

describe('deriveSas', () => {
  it('both ends derive the SAME number, whichever side they saw first', async () => {
    // This is the property the whole feature rests on: each device sees the
    // same two certificates but disagrees about which one is "local".
    expect(await deriveSas(FP_A, FP_B)).toBe(await deriveSas(FP_B, FP_A))
  })

  it('formats as two groups of three digits', async () => {
    expect(await deriveSas(FP_A, FP_B)).toMatch(/^\d{3} \d{3}$/)
  })

  it('is stable — a silent derivation change would break every mid-rollout pair', async () => {
    // Two devices on different deploy versions must still agree. If this
    // assertion fails, the change is a protocol break, not a refactor.
    expect(await deriveSas(FP_A, FP_B)).toBe('354 237')
  })

  it('a different certificate pair gives a different number', async () => {
    const fpMitm = FP_B.replace('4A', '5B')
    expect(await deriveSas(FP_A, fpMitm)).not.toBe(await deriveSas(FP_A, FP_B))
  })
})
