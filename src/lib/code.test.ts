import { describe, expect, it, vi } from 'vitest'
import { isValidCode, mintCode, normaliseCode } from './code'

// The pairing code is the ONLY authentication this product has — whoever joins
// the room first becomes your peer. So these are not decorative tests: an
// alphabet typo that shrinks the keyspace, or a normalise() that quietly
// mangles a valid code, is a security bug and a support bug respectively.

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

describe('mintCode', () => {
  it('is six characters from the 32-glyph alphabet', () => {
    for (let i = 0; i < 200; i++) {
      const code = mintCode()
      expect(code).toHaveLength(6)
      for (const ch of code) expect(ALPHABET).toContain(ch)
    }
  })

  it('never emits the look-alike glyphs a human would misread', () => {
    // I/1 and O/0 are dropped on purpose: this code gets read down a phone.
    const joined = Array.from({ length: 500 }, mintCode).join('')
    expect(joined).not.toMatch(/[IO01]/)
  })

  it('is accepted by the Worker regex it has to survive', () => {
    for (let i = 0; i < 50; i++) expect(isValidCode(mintCode())).toBe(true)
  })

  it('draws from crypto.getRandomValues, never Math.random', () => {
    // THE security assertion in this file, and the one the Screens spike gets
    // wrong (webrtc-spike.html:61-66). Math.random is a non-cryptographic PRNG
    // whose output is predictable from a handful of prior samples, and this
    // code is the only thing standing between a stranger and your session.
    //
    // Asserted with spies rather than by looking for collisions: a birthday
    // test over 32^6 is inherently probabilistic and would flake roughly once
    // in a hundred runs, which teaches people to re-run red builds.
    const crypt = vi.spyOn(globalThis.crypto, 'getRandomValues')
    const weak = vi.spyOn(Math, 'random')
    try {
      mintCode()
      expect(crypt).toHaveBeenCalledTimes(1)
      expect(weak).not.toHaveBeenCalled()
    } finally {
      crypt.mockRestore()
      weak.mockRestore()
    }
  })

  it('spends its whole keyspace — no repeats over a modest sample', () => {
    // Not a birthday test (see above); just a smoke check that consecutive
    // calls differ, which a broken/constant seed would fail every time.
    const seen = new Set(Array.from({ length: 200 }, mintCode))
    expect(seen.size).toBeGreaterThanOrEqual(199)
  })

  it('uses every glyph — a modulo bug would strand part of the alphabet', () => {
    const used = new Set(Array.from({ length: 4000 }, mintCode).join(''))
    expect(used.size).toBe(ALPHABET.length)
  })
})

describe('normaliseCode', () => {
  it('upper-cases, because the Worker only accepts [A-Z0-9]', () => {
    expect(normaliseCode('abc234')).toBe('ABC234')
  })

  it('strips the separators people add when reading a code aloud', () => {
    expect(normaliseCode(' abc-234 ')).toBe('ABC234')
    expect(normaliseCode('ABC 234')).toBe('ABC234')
    expect(normaliseCode('abc.234')).toBe('ABC234')
  })

  it('caps at the Worker maximum rather than producing a code it will reject', () => {
    expect(normaliseCode('ABCDEFGHIJKL')).toHaveLength(8)
  })

  it('pulls the code out of a pasted join link', () => {
    // This is what the "Copy the link" button puts on the clipboard, so it is
    // what people paste into the code box.
    expect(normaliseCode('https://opensource.unisim.co.uk/beam/?c=ABC234')).toBe('ABC234')
    expect(normaliseCode('http://localhost:5197/?c=abc234')).toBe('ABC234')
    expect(normaliseCode('  https://x.dev/beam/?utm=1&c=ZZ99AA  ')).toBe('ZZ99AA')
  })

  it('refuses a link with no code rather than inventing one from the hostname', () => {
    // Regression guard. Naive punctuation-stripping turns any https:// URL
    // into "HTTPSOPE…" — eight characters that isValidCode() accepts and that
    // will never pair with anything, producing exactly the silent failure this
    // product cannot afford.
    expect(isValidCode(normaliseCode('https://opensource.unisim.co.uk/beam/'))).toBe(false)
    expect(normaliseCode('https://opensource.unisim.co.uk/beam/')).toBe('')
  })

  it('is idempotent', () => {
    const once = normaliseCode('ab c-234')
    expect(normaliseCode(once)).toBe(once)
  })
})

describe('isValidCode', () => {
  it('matches the Worker regex exactly', () => {
    // src/worker.js → serveRendezvous: /^[A-Z0-9]{4,8}$/
    expect(isValidCode('ABCD')).toBe(true)
    expect(isValidCode('ABCDEFGH')).toBe(true)
    expect(isValidCode('ABC')).toBe(false)
    expect(isValidCode('ABCDEFGHI')).toBe(false)
    expect(isValidCode('abc234')).toBe(false)
    expect(isValidCode('ABC-234')).toBe(false)
    expect(isValidCode('')).toBe(false)
  })
})
