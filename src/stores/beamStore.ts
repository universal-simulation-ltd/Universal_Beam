import { create } from 'zustand'
import { BeamSession, type BeamMessage, type BeamPhase, type BeamRole } from '../lib/rtc'
import type { BeamFailure, BeamRoute } from '../lib/diagnose'
import type { BeamTransfer } from '../lib/files'
import { createDiskSink, createMemorySink, supportsStreamingSave } from '../lib/fileSink'
import { isValidCode, mintCode, normaliseCode } from '../lib/code'

// One session at a time, held outside the store: it is an object with sockets
// and timers, not state, and putting it in the store would tempt React into
// treating it as a value to diff.
let session: BeamSession | null = null

interface BeamState {
  code: string
  role: BeamRole
  phase: BeamPhase
  signalling: boolean
  route: BeamRoute | null
  failure: BeamFailure | null
  messages: BeamMessage[]
  /** File transfers by id, both directions — rendered merged into the session
   *  timeline. Insertion order is arrival order, which is what we render. */
  transfers: Record<string, BeamTransfer>
  /** The six-digit safety number both devices should agree on. Null until the
   *  channel is up, and null if a fingerprint could not be read. */
  sas: string | null
  /** True when the code came from a scanned link rather than being minted here. */
  joinedFromLink: boolean
  /** The peer's protocol version, or null while it is still undecided. `1` is
   *  a build that predates files and will swallow a file offer in silence. */
  peerProtocol: number | null

  setCode(raw: string): void
  newCode(): void
  /** Take a code read off the OTHER device and connect to it. */
  joinCode(raw: string): void
  connect(): void
  disconnect(): void
  send(body: string): boolean
  sendFiles(files: Iterable<File>): void
  /** Accept an incoming offer. Must be called from the click itself — on
   *  Chrome/Edge it opens the save dialog, which needs the user's activation. */
  acceptTransfer(id: string): Promise<void>
  declineTransfer(id: string): void
  cancelTransfer(id: string): void
  clearMessages(): void
}

export const useBeamStore = create<BeamState>((set, get) => ({
  code: '',
  role: 'host',
  phase: 'idle',
  signalling: false,
  route: null,
  failure: null,
  messages: [],
  transfers: {},
  sas: null,
  joinedFromLink: false,
  peerProtocol: null,

  setCode(raw) {
    if (get().phase !== 'idle' && get().phase !== 'failed' && get().phase !== 'ended') return
    set({ code: normaliseCode(raw) })
  },

  newCode() {
    get().disconnect()
    set({ code: mintCode(), role: 'host', joinedFromLink: false, messages: [], transfers: {}, failure: null, route: null })
    get().connect()
  },

  joinCode(raw) {
    const code = normaliseCode(raw)
    if (!isValidCode(code)) return
    get().disconnect()
    // 'guest' is a label the room echoes to the peer and nothing more — the
    // actual offer/answer roles are settled by BeamSession's nonce tie-break,
    // so two devices that both called themselves 'guest' still connect.
    set({ code, role: 'guest', joinedFromLink: false, messages: [], transfers: {}, failure: null, route: null })
    get().connect()
  },

  connect() {
    const { code, role } = get()
    if (!isValidCode(code)) return
    session?.close()
    set({ phase: 'idle', failure: null, route: null, signalling: false, sas: null, peerProtocol: null })

    session = new BeamSession(code, role, {
      onPhase: (phase) => set({ phase }),
      onMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),
      onFailure: (failure) => set({ failure }),
      onRoute: (route) => set({ route }),
      onSignalling: (signalling) => set({ signalling }),
      onTransfer: (t) => set((s) => ({ transfers: { ...s.transfers, [t.id]: t } })),
      onSas: (sas) => set({ sas }),
      onPeerProtocol: (peerProtocol) => set({ peerProtocol }),
    })
    session.start()
  },

  disconnect() {
    session?.close()
    session = null
    set({ phase: 'idle', signalling: false, route: null, sas: null, peerProtocol: null })
  },

  send(body) {
    const trimmed = body.replace(/\s+$/, '')
    if (!trimmed) return false
    return session?.send(trimmed) != null
  },

  sendFiles(files) {
    for (const file of files) session?.sendFile(file)
  },

  async acceptTransfer(id) {
    const t = get().transfers[id]
    if (!t || t.status !== 'offered' || !session) return
    if (supportsStreamingSave()) {
      // The picker MUST be the first thing this click does — user activation
      // does not survive arbitrary awaits.
      const sink = await createDiskSink(t.name)
      if (!sink) {
        // Closing the save dialog IS an answer; tell the sender rather than
        // leaving their offer hanging.
        session.declineFile(id)
        return
      }
      session.acceptFile(id, sink)
      return
    }
    session.acceptFile(id, createMemorySink(t.name, t.mime))
  },

  declineTransfer(id) {
    session?.declineFile(id)
  },

  cancelTransfer(id) {
    session?.cancelTransfer(id)
  },

  clearMessages() {
    set({ messages: [] })
  },
}))

/** Bootstrap from the URL. A scanned QR carries ?c=<CODE>, and the scanner
 *  joins as 'guest' so the two sides never both claim the same role — though
 *  BeamSession's nonce tie-break means it would still work if they did.
 *
 *  ⚠️ Idempotent on purpose. React StrictMode invokes mount effects twice in
 *  development, and a second call would open a SECOND socket on the same code.
 *  The rendezvous room caps at two peers (MAX_PEERS in
 *  opensource-portal/src/rendezvous.js), so our own two sockets would fill it
 *  and the real peer would be turned away with `409 room full` — a bug that
 *  appears only in dev and looks exactly like a network fault. */
let bootstrapped = false

export function initFromUrl(): void {
  if (bootstrapped) return
  bootstrapped = true

  const params = new URLSearchParams(window.location.search)
  const linked = normaliseCode(params.get('c') ?? '')
  if (isValidCode(linked)) {
    useBeamStore.setState({ code: linked, role: 'guest', joinedFromLink: true })
    useBeamStore.getState().connect()
    return
  }
  // No link: mint a fresh code and open the room immediately, so the QR on
  // screen is live the instant the page paints and the other device can scan
  // it without anyone pressing anything first.
  useBeamStore.setState({ code: mintCode(), role: 'host', joinedFromLink: false })
  useBeamStore.getState().connect()
}

/** The link encoded in the QR / shown for copying. */
export function joinUrl(code: string): string {
  const base = `${window.location.origin}${import.meta.env.BASE_URL}`
  return `${base}?c=${encodeURIComponent(code)}`
}
