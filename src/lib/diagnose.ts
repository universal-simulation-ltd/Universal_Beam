// Why the connection failed, in words a person can act on.
//
// This module exists because of one product decision: Universal Beam is
// DIRECT-OR-FAIL. There is no paid TURN relay standing behind a failed ICE
// negotiation, so on some networks — symmetric NAT, locked-down corporate
// Wi-Fi, some mobile carriers — two devices simply cannot reach each other and
// nothing we do in JavaScript will change that.
//
// Given that, the single worst thing this app could do is spin forever. A
// spinner tells the user nothing, so they wait, then reload, then try again,
// then conclude the product is broken. A sentence naming the cause and one
// thing to try costs us a failed transfer and keeps the user's trust. That
// trade is the whole reason this file is as long as it is.
//
// Everything here is derived from evidence we actually collected during the
// negotiation (see IceEvidence), not from guessing. Where we don't know, the
// copy says we don't know.

export interface IceEvidence {
  /** Did the room ever tell us a second peer arrived? */
  pairedWithPeer: boolean
  /** Did we exchange session descriptions (offer/answer) with them? */
  sdpExchanged: boolean
  /** Candidate types WE gathered: 'host' (LAN), 'srflx' (via STUN), 'relay' (TURN). */
  localTypes: Set<string>
  /** Candidate types the PEER sent us. */
  remoteTypes: Set<string>
  /** How many candidates the peer sent in total. */
  remoteCount: number
  /** Did ICE gathering finish, or did we give up mid-flight? */
  gatheringComplete: boolean
  /** Terminal RTCPeerConnection state when we gave up. */
  connectionState: RTCPeerConnectionState | 'timeout'
  /** Were any TURN servers even offered to us by /rtc/turn? */
  turnOffered: boolean
}

export interface BeamFailure {
  /** One short line, the headline of the error card. */
  headline: string
  /** Two or three sentences: what happened and why. No jargon. */
  explain: string
  /** Concrete things to try, best first. May be empty. */
  fixes: string[]
  /** The evidence, for a bug report. Shown behind a "details" toggle. */
  technical: string
}

function technicalSummary(e: IceEvidence): string {
  const fmt = (s: Set<string>) => (s.size ? [...s].sort().join(', ') : 'none')
  return [
    `state=${e.connectionState}`,
    `paired=${e.pairedWithPeer}`,
    `sdp=${e.sdpExchanged}`,
    `local candidates=[${fmt(e.localTypes)}]`,
    `remote candidates=[${fmt(e.remoteTypes)}] (${e.remoteCount})`,
    `gathering=${e.gatheringComplete ? 'complete' : 'incomplete'}`,
    `turn offered=${e.turnOffered}`,
  ].join(' · ')
}

export function diagnose(e: IceEvidence): BeamFailure {
  const technical = technicalSummary(e)

  // ── The peer never showed up ───────────────────────────────────────────────
  // Not a NAT problem at all. Distinguishing this from a traversal failure
  // matters: telling someone to "switch Wi-Fi" when their friend simply hasn't
  // scanned the code yet is actively unhelpful.
  if (!e.pairedWithPeer) {
    return {
      headline: 'The other device never joined',
      explain:
        'We waited in the pairing room but nothing else arrived. Either the code was never entered on the second device, or it was entered somewhere that could not reach the internet.',
      fixes: [
        'Check the code on the second device matches exactly.',
        'Make sure the second device has an internet connection — pairing needs one, even when both devices are on the same Wi-Fi.',
      ],
      technical,
    }
  }

  // ── Paired, but the negotiation never started ─────────────────────────────
  if (!e.sdpExchanged) {
    return {
      headline: 'The two devices could not agree on a connection',
      explain:
        'The other device joined, but the two browsers never finished swapping connection details. This usually means one of them closed the tab, or a browser extension is blocking WebRTC.',
      fixes: [
        'Try again — most of the time this is a tab that got closed mid-pair.',
        'If you use a privacy extension that blocks WebRTC, allow it for this site.',
      ],
      technical,
    }
  }

  // ── We could not discover our own public address ──────────────────────────
  // No server-reflexive candidate means the STUN probe (UDP to
  // stun.cloudflare.com:3478) got no answer — the classic signature of a
  // firewall that drops outbound UDP. Nothing beyond the LAN will work.
  if (!e.localTypes.has('srflx') && !e.localTypes.has('relay')) {
    return {
      headline: 'Your network blocks the connection we need',
      explain:
        'This network would not let us work out how the other device should reach you — the standard discovery request (UDP) got no reply, which is what a locked-down office or guest network usually does. On a network like this, a direct connection is only possible if both devices are on it.',
      fixes: [
        'Put both devices on the same Wi-Fi and try again.',
        'If you are on a work or guest network, try a personal hotspot instead.',
      ],
      technical,
    }
  }

  // ── The peer never sent us a route ────────────────────────────────────────
  if (e.remoteCount === 0) {
    return {
      headline: 'The other device never offered a way in',
      explain:
        'We told the other device how to reach us, but it sent nothing back. Its network is almost certainly the one blocking peer-to-peer connections.',
      fixes: [
        'Try again with both devices on the same Wi-Fi.',
        'If the other device is on mobile data or a work network, that is the likely cause — a personal hotspot usually works.',
      ],
      technical,
    }
  }

  // ── Both sides tried, both had routes, and it still failed ────────────────
  // This is the honest symmetric-NAT case, and it is the one this app cannot
  // fix without a paid TURN relay. Say that, rather than implying a retry will
  // help — retrying identical conditions produces an identical failure.
  const bothPublic = e.localTypes.has('srflx') && e.remoteTypes.has('srflx')
  return {
    headline: 'These two devices cannot reach each other directly',
    explain: bothPublic
      ? 'Both devices found their public addresses and tried every route between them, and none got through. This is almost always a "symmetric NAT" — a router or mobile carrier that hands out a different address for every connection, so the address one device advertises is not the one the other can actually use. Universal Beam only sends peer-to-peer: it will not bounce your text through our servers to get around this, so there is nothing left to try on this pair of networks.'
      : 'The two devices exchanged routes but none of them connected. Something between them — a firewall, a carrier, or a corporate network — is blocking peer-to-peer traffic.',
    fixes: [
      'Put both devices on the same Wi-Fi. On one network this works essentially every time.',
      'A phone hotspot is the quickest workaround if a work or public network is in the way.',
      'A VPN on either device can also cause this — turn it off and try again.',
    ],
    technical,
  }
}

// ── Success side: what route did we actually get? ───────────────────────────
// Reported to the user because "peer-to-peer" means two quite different things
// on a LAN and across the internet, and because a `relay` result would quietly
// contradict this app's core claim — better to see it than to assume it can't
// happen.

export type RouteKind = 'local' | 'internet' | 'relay' | 'unknown'

export interface BeamRoute {
  kind: RouteKind
  label: string
  detail: string
  localType?: string
  remoteType?: string
}

export function describeRoute(localType?: string, remoteType?: string): BeamRoute {
  if (localType === 'relay' || remoteType === 'relay') {
    return {
      kind: 'relay',
      label: 'Relayed',
      detail:
        'The connection is going through a relay server. It is still end-to-end encrypted — the relay only sees scrambled bytes — but it is not the direct path this app aims for.',
      localType,
      remoteType,
    }
  }
  if (localType === 'host' && remoteType === 'host') {
    return {
      kind: 'local',
      label: 'Direct — over your local network',
      detail: 'Your text goes straight across the network you are both on. It never leaves the building.',
      localType,
      remoteType,
    }
  }
  if (localType && remoteType) {
    return {
      kind: 'internet',
      label: 'Direct — across the internet',
      detail: 'A direct link between the two devices. Your text does not pass through any server of ours.',
      localType,
      remoteType,
    }
  }
  return {
    kind: 'unknown',
    label: 'Direct',
    detail: 'Connected peer-to-peer. (Your browser did not report which route it chose.)',
    localType,
    remoteType,
  }
}
