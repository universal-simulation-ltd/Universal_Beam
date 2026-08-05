// BeamSession — pair two browsers, open a data channel, move text.
//
// ── The shape of the thing ──────────────────────────────────────────────────
//
//   browser A ──wss──┐                     ┌──wss── browser B
//                    ├─ rendezvous room ───┤            (a Durable Object in
//                    │  (SDP + ICE only)   │             opensource-portal;
//   browser A ═══════╪══ RTCDataChannel ═══╪═══════ browser B
//                    │   (your text)       │             one instance per code)
//
// The rendezvous carries the negotiation and NOTHING ELSE. Once the data
// channel opens we close the WebSocket outright — see closeSignalling() — so
// the server is not merely trusted to stay out of the payload path, it is
// physically removed from it. That is the product.
//
// ── What this deliberately does not do ─────────────────────────────────────
//
// * No LAN discovery. A browser tab cannot browse mDNS and cannot join a
//   multicast group; there is no web API for either. That is why pairing is an
//   explicit code, and why two devices on the same Wi-Fi STILL need the
//   internet to find each other. Everything about this app's UX falls out of
//   that one constraint.
// * No relay fallback. If ICE fails, we fail — loudly, with a reason (see
//   diagnose.ts). We do not bounce the text through the rendezvous instead.
//   Relaying text would work and would cost nothing, but "no server ever holds
//   your text" stops being true the moment there is a path where it does, and
//   a privacy claim with an asterisk is worth less than the feature it buys.
// * No TURN dependency. We ask /rtc/turn for ICE servers and use whatever it
//   gives us; today that is public STUN only. If TURN is ever configured this
//   code picks it up with no change, and describeRoute() will report 'relay'
//   honestly rather than letting it pass as direct.

import { describeRoute, diagnose, type BeamFailure, type BeamRoute } from './diagnose'

/** Where the rendezvous lives.
 *
 * In production Beam is served from opensource.unisim.co.uk/beam, so the
 * rendezvous is same-origin and this is ''. In dev the app runs on localhost,
 * so we need an absolute origin — either a local `wrangler dev` of
 * opensource-portal (VITE_RENDEZVOUS_ORIGIN=http://localhost:8788) or the real
 * one. Cross-origin is fine: WebSocket upgrades are not subject to CORS and
 * /rtc/turn sets no credentials. */
export const RENDEZVOUS_ORIGIN: string =
  (import.meta.env.VITE_RENDEZVOUS_ORIGIN as string | undefined) ??
  (import.meta.env.PROD ? '' : 'https://opensource.unisim.co.uk')

function httpBase(): string {
  return RENDEZVOUS_ORIGIN || window.location.origin
}

function wsUrl(code: string, role: string): string {
  const base = httpBase()
  return `${base.replace(/^http/, 'ws')}/rtc/room?code=${encodeURIComponent(code)}&role=${encodeURIComponent(role)}`
}

export type BeamPhase =
  | 'idle'
  /** In the room, nobody else here yet. The QR is live; this can last a while. */
  | 'waiting'
  /** Peer arrived; ICE is in flight. Should resolve in a couple of seconds. */
  | 'pairing'
  /** Data channel open. Text flows. */
  | 'connected'
  /** Gave up. `failure` says why, in English. */
  | 'failed'
  /** Peer disconnected, or we did. Not an error. */
  | 'ended'

export type BeamRole = 'host' | 'guest'

export interface BeamMessage {
  id: string
  body: string
  /** 'in' = arrived from the peer, 'out' = we sent it. */
  dir: 'in' | 'out'
  at: number
}

export interface BeamCallbacks {
  onPhase(phase: BeamPhase): void
  onMessage(msg: BeamMessage): void
  onFailure(failure: BeamFailure): void
  onRoute(route: BeamRoute): void
  /** True while the pairing WebSocket is open. Goes false — deliberately —
   *  a few seconds after the data channel opens. */
  onSignalling(open: boolean): void
}

/** How long we let ICE run before declaring direct-or-fail. Real successful
 *  connections settle in well under two seconds on a LAN and under five across
 *  the internet; twenty is generous enough that we are not cutting off a slow
 *  mobile network, and short enough that nobody sits watching a spinner. */
const CONNECT_TIMEOUT_MS = 20_000

/** The rendezvous room self-destructs 10 minutes after the FIRST peer joins
 *  (ROOM_TTL_MS in opensource-portal/src/rendezvous.js — wall-clock, armed by
 *  the first joiner, never extended). For Screens that is a pairing window and
 *  it is fine. Here, a host can legitimately leave the code on screen while
 *  they walk to the other room, so the room dying underneath them is a real
 *  bug — and from the user's side it looks like the app silently gave up.
 *
 *  So: if the socket closes while we are still WAITING, we transparently
 *  re-join. A fresh join creates a fresh DO with a fresh alarm, so this works
 *  indefinitely and the user never learns the room had a lifetime.
 *
 *  We do NOT re-join after pairing has begun — at that point both sides are
 *  mid-negotiation and silently restarting would race. That case fails
 *  properly, with a reason. */
const REJOIN_DELAY_MS = 1_200
const MAX_REJOINS = 200

/** Grace period between the data channel opening and us hanging up on the
 *  rendezvous. Non-zero because trickle ICE keeps arriving for a moment after
 *  the first candidate pair succeeds, and a later pair is often a better route.
 *  Long enough to get that, short enough that the server is out of the picture
 *  before anyone has finished reading the "connected" banner. */
const SIGNALLING_LINGER_MS = 4_000

const ROOM_CONTROL = new Set(['waiting', 'paired', 'peer-left'])

interface Signal {
  t: 'sdp' | 'ice' | 'hello'
  kind?: 'offer' | 'answer'
  sdp?: RTCSessionDescriptionInit
  cand?: RTCIceCandidateInit
  tie?: number
}

export class BeamSession {
  readonly code: string
  readonly role: BeamRole

  private cb: BeamCallbacks
  private ws: WebSocket | null = null
  private pc: RTCPeerConnection | null = null
  private dc: RTCDataChannel | null = null

  private phase: BeamPhase = 'idle'
  private disposed = false
  private rejoins = 0
  private weClosedSignalling = false

  private tie = 0
  private peerTie: number | null = null
  private negotiating = false

  private pendingCandidates: RTCIceCandidateInit[] = []
  private queuedSignals: Signal[] = []
  private remoteDescriptionSet = false

  private watchdog: ReturnType<typeof setTimeout> | null = null
  private lingerTimer: ReturnType<typeof setTimeout> | null = null
  private rejoinTimer: ReturnType<typeof setTimeout> | null = null

  // Evidence for diagnose(). Collected as we go so a failure can be explained
  // from what actually happened rather than from a guess.
  private ev = {
    pairedWithPeer: false,
    sdpExchanged: false,
    localTypes: new Set<string>(),
    remoteTypes: new Set<string>(),
    remoteCount: 0,
    gatheringComplete: false,
    turnOffered: false,
  }

  constructor(code: string, role: BeamRole, cb: BeamCallbacks) {
    this.code = code
    this.role = role
    this.cb = cb
  }

  // ── lifecycle ─────────────────────────────────────────────────────────────

  start(): void {
    if (this.disposed) return
    this.openRoom()
  }

  /** Send a line of text to the peer. Returns false if the channel isn't open. */
  send(body: string): BeamMessage | null {
    if (!this.dc || this.dc.readyState !== 'open' || !body) return null
    const msg: BeamMessage = { id: crypto.randomUUID(), body, dir: 'out', at: Date.now() }
    this.dc.send(JSON.stringify({ v: 1, t: 'text', id: msg.id, body, at: msg.at }))
    this.cb.onMessage(msg)
    return msg
  }

  close(): void {
    this.disposed = true
    this.clearTimers()
    this.teardownPeer()
    this.closeSignalling(1000, 'bye')
    if (this.phase !== 'failed') this.setPhase('ended')
  }

  private clearTimers(): void {
    for (const t of [this.watchdog, this.lingerTimer, this.rejoinTimer]) if (t) clearTimeout(t)
    this.watchdog = this.lingerTimer = this.rejoinTimer = null
  }

  private setPhase(p: BeamPhase): void {
    if (this.phase === p) return
    this.phase = p
    this.cb.onPhase(p)
  }

  // ── the rendezvous socket ─────────────────────────────────────────────────

  private openRoom(): void {
    this.weClosedSignalling = false
    let ws: WebSocket
    try {
      ws = new WebSocket(wsUrl(this.code, this.role))
    } catch {
      this.fail('timeout')
      return
    }
    this.ws = ws
    this.setPhase('waiting')

    ws.onopen = () => this.cb.onSignalling(true)

    ws.onmessage = (e) => {
      let m: unknown
      try { m = JSON.parse(String(e.data)) } catch { return }
      if (!m || typeof m !== 'object') return
      const frame = m as { type?: string } & Signal

      // Frames the ROOM generates carry `type`; frames a PEER sends carry `t`.
      // Keeping those namespaces apart is the difference between "the room told
      // me my peer left" and "my peer sent me the word 'peer-left'".
      if (frame.type && ROOM_CONTROL.has(frame.type)) {
        this.onRoomControl(frame.type)
        return
      }
      if (frame.t) void this.onSignal(frame)
    }

    ws.onclose = () => {
      this.cb.onSignalling(false)
      if (this.disposed || this.weClosedSignalling) return

      // Still waiting for a peer? The room's 10-minute TTL almost certainly
      // just fired. Re-join quietly; the user's code is unchanged and their QR
      // stays valid, so nothing about their situation has actually changed.
      if (this.phase === 'waiting' && this.rejoins < MAX_REJOINS) {
        this.rejoins += 1
        this.rejoinTimer = setTimeout(() => { if (!this.disposed) this.openRoom() }, REJOIN_DELAY_MS)
        return
      }
      // Mid-negotiation, or connected. If we're connected this is harmless —
      // the peer-to-peer link does not need the room. If we're not, the
      // watchdog will produce a proper diagnosis shortly.
      if (this.phase === 'pairing') this.fail('timeout')
    }

    ws.onerror = () => {
      // A failed upgrade usually means 409 room full — someone else is already
      // paired on this code. onclose handles the retry/fail decision; we only
      // note it so the diagnosis isn't misleading.
      this.cb.onSignalling(false)
    }
  }

  private closeSignalling(code = 1000, reason = 'done'): void {
    const ws = this.ws
    this.ws = null
    if (!ws) return
    this.weClosedSignalling = true
    try { ws.close(code, reason) } catch { /* already closing */ }
    this.cb.onSignalling(false)
  }

  private sendSignal(s: Signal): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(s))
  }

  private onRoomControl(type: string): void {
    if (type === 'waiting') { this.setPhase('waiting'); return }

    if (type === 'paired') {
      this.ev.pairedWithPeer = true
      this.setPhase('pairing')
      this.armWatchdog()
      // Decide who offers by exchanging a random number rather than trusting
      // the role in the URL. Roles come from a link the user may well have
      // opened on BOTH devices, in which case two "guests" would sit waiting
      // for each other's offer forever. A nonce cannot collide that way
      // (and if it does — one in four billion — both sides re-roll).
      this.tie = crypto.getRandomValues(new Uint32Array(1))[0]
      this.sendSignal({ t: 'hello', tie: this.tie })
      void this.maybeNegotiate()
      return
    }

    if (type === 'peer-left') {
      // Once the data channel is up, the room is irrelevant — and we ourselves
      // close our socket a few seconds after connecting, which makes the OTHER
      // peer see exactly this frame. Treating it as an error would mean every
      // successful session ended in a spurious "peer left" a moment later.
      if (this.dc?.readyState === 'open') return
      if (this.phase === 'connected') return

      // We had a peer, mid-negotiation, and they went away — a closed tab or a
      // reload, not a network fault. Our socket is still in the room, so the
      // honest state is "waiting for the other device" again: the code on
      // screen is still good and the next joiner pairs with us normally. Going
      // to 'ended' here would strand the user on a dead screen and make them
      // mint a new code for no reason.
      this.clearTimers()
      this.teardownPeer()
      this.resetEvidence()
      this.tie = 0
      this.setPhase('waiting')
    }
  }

  /** Forget what we learned about the last attempt. Without this a peer who
   *  joined and left would leave `pairedWithPeer: true` behind, and a later
   *  genuine "nobody ever joined" timeout would be diagnosed as a NAT problem. */
  private resetEvidence(): void {
    this.ev = {
      pairedWithPeer: false,
      sdpExchanged: false,
      localTypes: new Set<string>(),
      remoteTypes: new Set<string>(),
      remoteCount: 0,
      gatheringComplete: false,
      turnOffered: this.ev.turnOffered,
    }
  }

  // ── negotiation ───────────────────────────────────────────────────────────

  private async maybeNegotiate(): Promise<void> {
    if (this.negotiating || this.peerTie === null || this.disposed) return
    this.negotiating = true
    if (this.tie === this.peerTie) {
      // Astronomically unlikely; re-roll rather than deadlock.
      this.negotiating = false
      this.peerTie = null
      this.tie = crypto.getRandomValues(new Uint32Array(1))[0]
      this.sendSignal({ t: 'hello', tie: this.tie })
      return
    }
    await this.startPeerConnection(this.tie > this.peerTie)
  }

  /** Ask the Worker what ICE servers to use.
   *
   * ⚠️ In LOCAL DEV this fetch is blocked by CORS and you will see a red
   * "No 'Access-Control-Allow-Origin' header" line in the console. That is
   * expected and harmless, and it is not a bug to go and fix in
   * opensource-portal: `/rtc/turn` deliberately sets no CORS headers, and in
   * production Beam is served from the same origin (opensource.unisim.co.uk)
   * so the request is same-origin and succeeds. The catch below falls back to
   * the exact server the endpoint would have returned anyway — public STUN —
   * so dev and prod behave identically today. The day TURN is configured, dev
   * would silently not get it; that is the one thing to remember here. */
  private async iceServers(): Promise<RTCIceServer[]> {
    const fallback: RTCIceServer[] = [{ urls: ['stun:stun.cloudflare.com:3478'] }]
    try {
      const r = await fetch(`${httpBase()}/rtc/turn`)
      const data = (await r.json()) as { iceServers?: RTCIceServer[] }
      const servers = data.iceServers?.length ? data.iceServers : fallback
      this.ev.turnOffered = servers.some((s) =>
        (Array.isArray(s.urls) ? s.urls : [s.urls]).some((u) => String(u).startsWith('turn')),
      )
      return servers
    } catch {
      return fallback
    }
  }

  private async startPeerConnection(offerer: boolean): Promise<void> {
    const pc = new RTCPeerConnection({ iceServers: await this.iceServers() })
    if (this.disposed) { pc.close(); return }
    this.pc = pc

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        if (e.candidate.type) this.ev.localTypes.add(e.candidate.type)
        this.sendSignal({ t: 'ice', cand: e.candidate.toJSON() })
      } else {
        this.ev.gatheringComplete = true
      }
    }

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') this.fail('failed')
      if (pc.connectionState === 'disconnected' && this.phase === 'connected') {
        // A blip, not necessarily fatal — ICE may recover. Only report if the
        // data channel actually dies.
      }
    }

    if (offerer) {
      this.wireDataChannel(pc.createDataChannel('beam', { ordered: true }))
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      this.sendSignal({ t: 'sdp', kind: 'offer', sdp: pc.localDescription! })
    } else {
      pc.ondatachannel = (e) => this.wireDataChannel(e.channel)
    }

    // Anything that arrived while we were still fetching ICE servers.
    while (this.queuedSignals.length) await this.onSignal(this.queuedSignals.shift()!)
  }

  private async onSignal(s: Signal): Promise<void> {
    if (s.t === 'hello') {
      if (typeof s.tie === 'number') {
        this.peerTie = s.tie
        // The peer may have sent hello before we did; make sure it has ours.
        if (this.tie) this.sendSignal({ t: 'hello', tie: this.tie })
        void this.maybeNegotiate()
      }
      return
    }

    const pc = this.pc
    if (!pc) { this.queuedSignals.push(s); return }

    if (s.t === 'sdp' && s.sdp) {
      this.ev.sdpExchanged = true
      await pc.setRemoteDescription(s.sdp)
      this.remoteDescriptionSet = true
      while (this.pendingCandidates.length) {
        try { await pc.addIceCandidate(this.pendingCandidates.shift()!) } catch { /* stale candidate */ }
      }
      if (s.kind === 'offer') {
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        this.sendSignal({ t: 'sdp', kind: 'answer', sdp: pc.localDescription! })
      }
      return
    }

    if (s.t === 'ice' && s.cand) {
      this.ev.remoteCount += 1
      const type = /\btyp (\w+)/.exec(s.cand.candidate ?? '')?.[1]
      if (type) this.ev.remoteTypes.add(type)
      if (this.remoteDescriptionSet) {
        try { await pc.addIceCandidate(s.cand) } catch { /* stale candidate */ }
      } else {
        this.pendingCandidates.push(s.cand)
      }
    }
  }

  // ── the data channel ──────────────────────────────────────────────────────

  private wireDataChannel(channel: RTCDataChannel): void {
    this.dc = channel

    channel.onopen = () => {
      this.clearTimers()
      this.setPhase('connected')
      void this.reportRoute()
      // Hang up on the rendezvous. From here the two browsers talk directly and
      // the server has no part in the session — including no ability to see,
      // store or relay a single byte of it.
      this.lingerTimer = setTimeout(() => this.closeSignalling(1000, 'connected'), SIGNALLING_LINGER_MS)
    }

    channel.onclose = () => {
      if (this.disposed) return
      if (this.phase === 'connected') this.setPhase('ended')
    }

    channel.onmessage = (e) => {
      let m: unknown
      try { m = JSON.parse(String(e.data)) } catch { return }
      const f = m as { t?: string; id?: string; body?: string; at?: number }
      if (f.t !== 'text' || typeof f.body !== 'string') return
      this.cb.onMessage({
        id: typeof f.id === 'string' ? f.id : crypto.randomUUID(),
        body: f.body,
        dir: 'in',
        at: typeof f.at === 'number' ? f.at : Date.now(),
      })
    }
  }

  /** Ask the browser which candidate pair actually won, so the UI can say
   *  "over your local network" or "across the internet" truthfully instead of
   *  saying "peer-to-peer" and leaving the user to wonder what that means. */
  private async reportRoute(): Promise<void> {
    const pc = this.pc
    if (!pc) return
    try {
      const stats = await pc.getStats()
      let pairId: string | undefined
      stats.forEach((s) => {
        const r = s as RTCStats & { selectedCandidatePairId?: string }
        if (r.type === 'transport' && r.selectedCandidatePairId) pairId = r.selectedCandidatePairId
      })
      let pair = pairId ? (stats.get(pairId) as unknown as Record<string, unknown> | undefined) : undefined
      if (!pair) {
        // Firefox doesn't always publish transport.selectedCandidatePairId.
        stats.forEach((s) => {
          const r = s as unknown as Record<string, unknown>
          if (r.type === 'candidate-pair' && r.state === 'succeeded' && (r.nominated || r.selected)) pair = r
        })
      }
      if (!pair) { this.cb.onRoute(describeRoute()); return }
      const local = stats.get(String(pair.localCandidateId)) as unknown as Record<string, unknown> | undefined
      const remote = stats.get(String(pair.remoteCandidateId)) as unknown as Record<string, unknown> | undefined
      this.cb.onRoute(
        describeRoute(
          local?.candidateType as string | undefined,
          remote?.candidateType as string | undefined,
        ),
      )
    } catch {
      this.cb.onRoute(describeRoute())
    }
  }

  // ── failure ───────────────────────────────────────────────────────────────

  private armWatchdog(): void {
    if (this.watchdog) clearTimeout(this.watchdog)
    this.watchdog = setTimeout(() => this.fail('timeout'), CONNECT_TIMEOUT_MS)
  }

  private fail(state: RTCPeerConnectionState | 'timeout'): void {
    if (this.disposed || this.phase === 'connected' || this.phase === 'failed') return
    this.clearTimers()
    const failure = diagnose({ ...this.ev, connectionState: state })
    this.setPhase('failed')
    this.cb.onFailure(failure)
    this.teardownPeer()
    this.closeSignalling(1000, 'failed')
  }

  private teardownPeer(): void {
    if (this.dc) { try { this.dc.close() } catch { /* gone */ } this.dc = null }
    if (this.pc) { try { this.pc.close() } catch { /* gone */ } this.pc = null }
    this.remoteDescriptionSet = false
    this.pendingCandidates = []
    this.queuedSignals = []
    this.negotiating = false
    this.peerTie = null
  }
}

/** Waiting on a peer has no deadline, so this is how long the UI waits before
 *  gently suggesting the code may not have reached the other device. */
export const WAITING_NUDGE_MS = 45_000
