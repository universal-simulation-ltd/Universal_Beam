// FileTransferEngine — files over the beam data channel, both directions.
//
// The wire protocol rides the SAME ordered, reliable channel as text. Control
// frames are JSON strings; file bytes are raw binary messages. Because the
// channel is ordered, a binary message can only ever belong to the one incoming
// transfer that is currently accepted — the offer, the chunks and the final
// `file-done` cannot overtake each other. That single invariant is what lets
// the chunks go unlabelled, and it holds because EACH SIDE sends at most one
// file at a time (extra sends queue locally). Both sides may transfer
// simultaneously — my incoming bytes are the peer's outgoing, never my own.
//
//   A → B   {t:'file-offer', id, name, size, mime}
//   B → A   {t:'file-accept', id}        (or 'file-decline')
//   A → B   <binary chunk> ×N            (64 KiB each, backpressured)
//   A → B   {t:'file-done', id}
//   either  {t:'file-cancel', id}        (at any point after the offer)
//
// Backpressure is the real event, not a guessed sleep: we stop reading the
// file whenever `bufferedAmount` passes HIGH_WATER and resume on the channel's
// own `bufferedamountlow`, with the threshold set to LOW_WATER. A fixed delay
// would either starve a fast LAN link or blow the buffer on a slow one.
//
// This module never touches the DOM — where the received bytes GO is the
// sink's business (fileSink.ts), which is also what makes the whole protocol
// testable with two engines and a fake channel (files.test.ts).

/** 64 KiB — the largest data-channel message that is safe across every
 *  browser pairing. Chromium accepts 256 KiB, but the SCTP interop floor is
 *  64 KiB and a bigger chunk buys nothing once backpressure is real. */
export const CHUNK_SIZE = 64 * 1024

/** Stop reading the file when this much is sitting in the channel's buffer… */
export const HIGH_WATER = 4 * 1024 * 1024
/** …and resume once the browser has drained it down to this. */
export const LOW_WATER = 512 * 1024

/** Progress callbacks fire at most once per this many bytes (plus every state
 *  change). Every 64 KiB chunk would be thousands of store updates per file. */
const PROGRESS_STEP = 256 * 1024

/** The slice of RTCDataChannel the engine actually uses — narrow on purpose,
 *  so tests can hand in a plain object and the engine cannot reach anything
 *  it should not. */
export interface ChannelLike {
  send(data: string | ArrayBuffer): void
  bufferedAmount: number
  bufferedAmountLowThreshold: number
  // Shaped like lib.dom's declaration so a real RTCDataChannel satisfies this
  // structurally; the engine only ever assigns and fires it argument-free.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onbufferedamountlow: ((this: any, ev: Event) => unknown) | null
  readyState: RTCDataChannelState
}

/** Where received bytes go. Disk on browsers with the File System Access API,
 *  memory + a download everywhere else — see fileSink.ts. */
export interface FileSink {
  kind: 'disk' | 'memory'
  write(chunk: ArrayBuffer): Promise<void>
  /** Finalise. The memory sink triggers its download here. */
  close(): Promise<void>
  /** Discard a part-written file as best the sink can. */
  abort(): Promise<void>
}

export type TransferStatus =
  /** Outgoing, behind another transfer. Nothing sent yet; free to cancel. */
  | 'queued'
  /** Offer is with the other device, waiting for a human to answer. */
  | 'offered'
  | 'active'
  | 'done'
  | 'declined'
  | 'cancelled'
  | 'failed'

export interface BeamTransfer {
  id: string
  dir: 'in' | 'out'
  name: string
  size: number
  mime: string
  at: number
  status: TransferStatus
  /** Bytes handed to the transport (out) or written to the sink (in). */
  bytes: number
  /** How an incoming file was kept: streamed to disk, or downloaded. */
  savedAs?: 'disk' | 'memory'
  /** One sentence for the row when status is 'failed'. */
  error?: string
}

interface FileFrame {
  t: 'file-offer' | 'file-accept' | 'file-decline' | 'file-done' | 'file-cancel'
  id?: string
  name?: string
  size?: number
  mime?: string
}

export function isFileFrame(t: string): boolean {
  return t.startsWith('file-')
}

interface Outgoing {
  id: string
  file: File
  view: BeamTransfer
  cancelled: boolean
  /** True once streamCurrent() is running — its `finally` then owns clearing
   *  `current` and pumping the queue, so nobody else may, or a cancel arriving
   *  while the loop is parked on backpressure would start a SECOND loop and
   *  interleave two files' chunks. */
  streaming: boolean
}

interface Incoming {
  id: string
  view: BeamTransfer
  sink: FileSink | null
  /** Sink writes are async and chunks are not; the chain keeps them ordered. */
  writes: Promise<void>
  writeFailed: boolean
}

export class FileTransferEngine {
  private ch: ChannelLike
  private onUpdate: (t: BeamTransfer) => void

  private queue: Outgoing[] = []
  private current: Outgoing | null = null
  private incoming: Incoming | null = null
  /** The offer on the table, before accept/decline picks it up. */
  private pendingOffer: Incoming | null = null

  private drainWaiter: (() => void) | null = null
  /** Last byte count emitted per transfer — the throttle is per file, not per
   *  engine, or a second transfer would stay silent until it happened to pass
   *  the first one's total. */
  private lastProgress = new Map<string, number>()
  private closed = false

  constructor(ch: ChannelLike, onUpdate: (t: BeamTransfer) => void) {
    this.ch = ch
    this.onUpdate = onUpdate
    ch.bufferedAmountLowThreshold = LOW_WATER
    ch.onbufferedamountlow = () => {
      const w = this.drainWaiter
      this.drainWaiter = null
      w?.()
    }
  }

  // ── sending ───────────────────────────────────────────────────────────────

  /** Queue a file. Returns its transfer id, or null if the channel is gone. */
  send(file: File): string | null {
    if (this.closed || this.ch.readyState !== 'open') return null
    const out: Outgoing = {
      id: crypto.randomUUID(),
      file,
      cancelled: false,
      streaming: false,
      view: {
        id: '',
        dir: 'out',
        name: file.name,
        size: file.size,
        mime: file.type || 'application/octet-stream',
        at: Date.now(),
        status: 'queued',
        bytes: 0,
      },
    }
    out.view.id = out.id
    this.queue.push(out)
    this.emit(out.view)
    this.pump()
    return out.id
  }

  private pump(): void {
    if (this.closed || this.current || this.queue.length === 0) return
    const out = this.queue.shift()!
    if (out.cancelled) { this.pump(); return }
    this.current = out
    this.sendFrame({
      t: 'file-offer',
      id: out.id,
      name: out.view.name,
      size: out.view.size,
      mime: out.view.mime,
    })
    this.emit({ ...out.view, status: 'offered' })
  }

  private async streamCurrent(): Promise<void> {
    const out = this.current
    if (!out || out.streaming) return
    out.streaming = true
    this.emit({ ...out.view, status: 'active' })
    try {
      const { file } = out
      for (let offset = 0; offset < file.size; offset += CHUNK_SIZE) {
        // Reading via slice() keeps at most one chunk in our hands; the file
        // itself stays on disk until the browser needs each piece.
        const chunk = await file.slice(offset, offset + CHUNK_SIZE).arrayBuffer()
        if (out.cancelled || this.closed || this.ch.readyState !== 'open') return
        this.ch.send(chunk)
        this.progress(out.view, offset + chunk.byteLength)
        if (this.ch.bufferedAmount > HIGH_WATER) await this.drained()
        if (out.cancelled || this.closed) return
      }
      this.sendFrame({ t: 'file-done', id: out.id })
      this.emit({ ...out.view, status: 'done', bytes: file.size })
    } catch {
      // The likely cause: the File was moved or deleted under us mid-read.
      this.sendFrame({ t: 'file-cancel', id: out.id })
      this.emit({ ...out.view, status: 'failed', error: 'The file could not be read from disk.' })
    } finally {
      if (this.current === out) this.current = null
      this.pump()
    }
  }

  private drained(): Promise<void> {
    if (this.ch.bufferedAmount <= LOW_WATER) return Promise.resolve()
    return new Promise((resolve) => { this.drainWaiter = resolve })
  }

  private wakeDrain(): void {
    const w = this.drainWaiter
    this.drainWaiter = null
    w?.()
  }

  /** An outgoing transfer just ended early (cancel or decline). If its stream
   *  loop is running it may be parked on backpressure — wake it and let its
   *  `finally` clear `current` and pump. If it never started, do that here. */
  private endOutgoing(out: Outgoing): void {
    out.cancelled = true
    if (out.streaming) {
      this.wakeDrain()
      return
    }
    if (this.current === out) {
      this.current = null
      this.pump()
    }
  }

  // ── receiving ─────────────────────────────────────────────────────────────

  /** The UI answered the offer. The sink is created by the caller because
   *  opening a save dialog must happen inside the user's click. */
  accept(id: string, sink: FileSink): void {
    const inc = this.pendingOffer
    if (!inc || inc.id !== id || this.closed) { void sink.abort(); return }
    this.pendingOffer = null
    inc.sink = sink
    inc.view.savedAs = sink.kind
    this.incoming = inc
    this.sendFrame({ t: 'file-accept', id })
    this.emit({ ...inc.view, status: 'active' })
  }

  decline(id: string): void {
    const inc = this.pendingOffer
    if (!inc || inc.id !== id) return
    this.pendingOffer = null
    this.sendFrame({ t: 'file-decline', id })
    this.emit({ ...inc.view, status: 'declined' })
  }

  /** Either side, any live transfer. */
  cancel(id: string): void {
    const out = this.current?.id === id ? this.current : this.queue.find((o) => o.id === id)
    if (out) {
      this.sendFrame({ t: 'file-cancel', id })
      this.emit({ ...out.view, status: 'cancelled' })
      this.endOutgoing(out)
      return
    }
    const inc = this.incoming?.id === id ? this.incoming : this.pendingOffer?.id === id ? this.pendingOffer : null
    if (inc) {
      if (this.incoming === inc) this.incoming = null
      if (this.pendingOffer === inc) this.pendingOffer = null
      this.sendFrame({ t: 'file-cancel', id })
      void inc.sink?.abort()
      this.emit({ ...inc.view, status: 'cancelled' })
    }
  }

  onChunk(chunk: ArrayBuffer): void {
    const inc = this.incoming
    if (!inc || !inc.sink || inc.writeFailed) return
    inc.view.bytes += chunk.byteLength
    const sink = inc.sink
    inc.writes = inc.writes.then(
      () => sink.write(chunk),
      () => { /* already failed; keep the chain settled */ },
    ).catch(() => {
      // Disk full, or the user revoked the handle. Stop the peer wasting
      // bandwidth on bytes we cannot keep.
      inc.writeFailed = true
      this.sendFrame({ t: 'file-cancel', id: inc.id })
      void sink.abort()
      if (this.incoming === inc) this.incoming = null
      this.emit({ ...inc.view, status: 'failed', error: 'Saving failed on this device.' })
    })
    this.progress(inc.view, inc.view.bytes)
  }

  onFrame(f: FileFrame): void {
    if (this.closed) return
    switch (f.t) {
      case 'file-offer': {
        if (typeof f.id !== 'string' || typeof f.name !== 'string' || typeof f.size !== 'number' || f.size < 0) return
        // The peer's engine offers one file at a time; a second offer while one
        // is on the table means a peer we don't understand. Decline it.
        if (this.pendingOffer || this.incoming) { this.sendFrame({ t: 'file-decline', id: f.id }); return }
        const view: BeamTransfer = {
          id: f.id,
          dir: 'in',
          // A filename crosses a trust boundary here; keep it a plain string
          // and let React render it as text. Just bound the length.
          name: f.name.slice(0, 255) || 'file',
          size: f.size,
          mime: typeof f.mime === 'string' ? f.mime : 'application/octet-stream',
          at: Date.now(),
          status: 'offered',
          bytes: 0,
        }
        this.pendingOffer = { id: f.id, view, sink: null, writes: Promise.resolve(), writeFailed: false }
        this.emit(view)
        return
      }
      case 'file-accept': {
        if (this.current && this.current.id === f.id) void this.streamCurrent()
        return
      }
      case 'file-decline': {
        if (this.current && this.current.id === f.id) {
          this.emit({ ...this.current.view, status: 'declined' })
          this.endOutgoing(this.current)
        }
        return
      }
      case 'file-done': {
        const inc = this.incoming
        if (!inc || inc.id !== f.id) return
        this.incoming = null
        void inc.writes.then(async () => {
          if (inc.writeFailed) return
          if (inc.view.bytes !== inc.view.size) {
            await inc.sink?.abort()
            this.emit({ ...inc.view, status: 'failed', error: 'The transfer ended before the whole file arrived.' })
            return
          }
          await inc.sink?.close()
          this.emit({ ...inc.view, status: 'done' })
        }).catch(() => {
          this.emit({ ...inc.view, status: 'failed', error: 'Saving failed on this device.' })
        })
        return
      }
      case 'file-cancel': {
        const cur = this.current
        if (cur && cur.id === f.id) {
          this.emit({ ...cur.view, status: 'cancelled' })
          this.endOutgoing(cur)
          return
        }
        const inc = this.incoming?.id === f.id ? this.incoming : this.pendingOffer?.id === f.id ? this.pendingOffer : null
        if (inc) {
          if (this.incoming === inc) this.incoming = null
          if (this.pendingOffer === inc) this.pendingOffer = null
          void inc.sink?.abort()
          this.emit({ ...inc.view, status: 'cancelled' })
        }
        return
      }
    }
  }

  /** The channel died — connection closed, tab closing, session torn down.
   *  Everything in flight fails honestly; everything finished stays finished. */
  abortAll(reason: string): void {
    if (this.closed) return
    this.closed = true
    this.drainWaiter?.()
    this.drainWaiter = null
    for (const out of [this.current, ...this.queue]) {
      if (!out) continue
      out.cancelled = true
      this.emit({ ...out.view, status: 'failed', error: reason })
    }
    this.current = null
    this.queue = []
    for (const inc of [this.incoming, this.pendingOffer]) {
      if (!inc) continue
      void inc.sink?.abort()
      this.emit({ ...inc.view, status: 'failed', error: reason })
    }
    this.incoming = null
    this.pendingOffer = null
  }

  // ── plumbing ──────────────────────────────────────────────────────────────

  private sendFrame(f: FileFrame): void {
    if (this.ch.readyState !== 'open') return
    try { this.ch.send(JSON.stringify({ v: 1, ...f })) } catch { /* channel raced shut */ }
  }

  private progress(view: BeamTransfer, bytes: number): void {
    view.bytes = bytes
    const last = this.lastProgress.get(view.id) ?? 0
    if (bytes - last < PROGRESS_STEP && bytes !== view.size) return
    this.lastProgress.set(view.id, bytes)
    this.emit({ ...view, status: 'active' })
  }

  private emit(view: BeamTransfer): void {
    if (view.status !== 'active' && view.status !== 'queued' && view.status !== 'offered') {
      this.lastProgress.delete(view.id)
    }
    this.onUpdate({ ...view })
  }
}

/** "3.2 MB", "641 KB", "2.1 GB" — for the offer and progress rows. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = n
  let i = -1
  do { v /= 1024; i += 1 } while (v >= 1024 && i < units.length - 1)
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`
}
