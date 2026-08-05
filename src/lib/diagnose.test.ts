import { describe, expect, it } from 'vitest'
import { describeRoute, diagnose, type IceEvidence } from './diagnose'

// diagnose() is the product's failure surface. Because Beam is direct-or-fail
// with no paid TURN, a real slice of connections cannot succeed — and the ONLY
// thing standing between that and "this app is broken" is whether the sentence
// on screen names the right cause. So the assertions here are about which
// branch fires for which evidence, not about the prose.

function evidence(over: Partial<IceEvidence> = {}): IceEvidence {
  return {
    pairedWithPeer: true,
    sdpExchanged: true,
    localTypes: new Set(['host', 'srflx']),
    remoteTypes: new Set(['host', 'srflx']),
    remoteCount: 4,
    gatheringComplete: true,
    connectionState: 'failed',
    turnOffered: false,
    ...over,
  }
}

describe('diagnose', () => {
  it('blames the missing peer, not the network, when nobody joined', () => {
    const f = diagnose(evidence({ pairedWithPeer: false, sdpExchanged: false, connectionState: 'timeout' }))
    expect(f.headline).toMatch(/never joined/i)
    // Telling someone to "switch Wi-Fi" when their friend simply has not
    // entered the code yet is worse than saying nothing.
    expect(f.fixes.join(' ')).toMatch(/code/i)
    expect(f.fixes.join(' ')).not.toMatch(/symmetric/i)
  })

  it('calls out a half-finished handshake separately from a NAT failure', () => {
    const f = diagnose(evidence({ sdpExchanged: false }))
    expect(f.headline).toMatch(/could not agree/i)
    expect(f.fixes.join(' ')).toMatch(/try again/i)
  })

  it('identifies a UDP-blocking network from the absent srflx candidate', () => {
    const f = diagnose(evidence({ localTypes: new Set(['host']) }))
    expect(f.headline).toMatch(/your network/i)
    expect(f.explain).toMatch(/UDP/)
  })

  it('points at the OTHER side when only they sent nothing', () => {
    const f = diagnose(evidence({ remoteCount: 0, remoteTypes: new Set() }))
    expect(f.headline).toMatch(/other device never offered/i)
  })

  it('names symmetric NAT — and does NOT promise a retry will help', () => {
    const f = diagnose(evidence())
    expect(f.headline).toMatch(/cannot reach each other directly/i)
    expect(f.explain).toMatch(/symmetric NAT/i)
    // The whole point of this branch: retrying identical conditions produces
    // an identical failure, so the copy must not suggest it.
    expect(f.explain).toMatch(/nothing left to try/i)
  })

  it('stays vaguer when the evidence is vaguer', () => {
    // Only one side found a public address: we genuinely do not know it is
    // symmetric NAT, so we must not say so.
    const f = diagnose(evidence({ remoteTypes: new Set(['host']) }))
    expect(f.headline).toMatch(/cannot reach each other directly/i)
    expect(f.explain).not.toMatch(/symmetric NAT/i)
  })

  it('always carries a technical summary that can be pasted into a bug report', () => {
    const f = diagnose(evidence({ localTypes: new Set(['host']), remoteTypes: new Set() }))
    expect(f.technical).toContain('state=failed')
    expect(f.technical).toContain('local candidates=[host]')
    expect(f.technical).toContain('remote candidates=[none]')
    expect(f.technical).toContain('turn offered=false')
  })

  it('never returns an empty headline or explanation for any evidence shape', () => {
    const shapes: Partial<IceEvidence>[] = [
      { pairedWithPeer: false },
      { sdpExchanged: false },
      { localTypes: new Set() },
      { remoteCount: 0 },
      { connectionState: 'timeout' },
      { turnOffered: true, localTypes: new Set(['host', 'srflx', 'relay']) },
      {},
    ]
    for (const shape of shapes) {
      const f = diagnose(evidence(shape))
      expect(f.headline.length).toBeGreaterThan(0)
      expect(f.explain.length).toBeGreaterThan(0)
      expect(f.technical.length).toBeGreaterThan(0)
    }
  })
})

describe('describeRoute', () => {
  it('reports a relay honestly rather than letting it pass as direct', () => {
    // If TURN is ever configured, this is the case that would otherwise
    // quietly contradict the product claim. Better to show it.
    const r = describeRoute('relay', 'srflx')
    expect(r.kind).toBe('relay')
    expect(r.detail).toMatch(/relay/i)
    expect(r.label).not.toMatch(/direct/i)
  })

  it('distinguishes same-LAN from across-the-internet', () => {
    expect(describeRoute('host', 'host').kind).toBe('local')
    expect(describeRoute('srflx', 'srflx').kind).toBe('internet')
    expect(describeRoute('host', 'srflx').kind).toBe('internet')
  })

  it('admits it does not know rather than guessing', () => {
    const r = describeRoute()
    expect(r.kind).toBe('unknown')
    expect(r.detail).toMatch(/did not report/i)
  })

  it('only claims "never leaves the building" for a genuine host-to-host pair', () => {
    // The banned marketing sentence is allowed here and ONLY here, because on
    // a host↔host candidate pair it is literally true.
    expect(describeRoute('host', 'host').detail).toMatch(/never leaves the building/i)
    expect(describeRoute('srflx', 'srflx').detail).not.toMatch(/never leaves/i)
  })
})
