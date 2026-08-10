import { describe, expect, it } from 'vitest'
import {
  CHUNK_SIZE,
  FileTransferEngine,
  HIGH_WATER,
  formatBytes,
  isFileFrame,
  type BeamTransfer,
  type ChannelLike,
  type FileSink,
} from './files'

// Two engines, back to back over a fake channel pair, moving REAL bytes.
// This is the protocol's proving ground: ordering, the accept/decline
// handshake, cancellation from either end, the queue, and backpressure —
// everything except an actual RTCDataChannel, which the e2e suite covers.

class FakeChannel implements ChannelLike {
  bufferedAmount = 0
  bufferedAmountLowThreshold = 0
  onbufferedamountlow: ChannelLike['onbufferedamountlow'] = null
  readyState: RTCDataChannelState = 'open'
  deliver: ((data: string | ArrayBuffer) => void) | null = null
  sent: (string | ArrayBuffer)[] = []

  send(data: string | ArrayBuffer): void {
    this.sent.push(data)
    // Async like the real thing — a frame never arrives inside the send call.
    queueMicrotask(() => this.deliver?.(data))
  }
}

/** Route a channel's traffic into the engine on the far side, the way
 *  rtc.ts's onmessage dispatch does. */
function pipe(from: FakeChannel, to: FileTransferEngine): void {
  from.deliver = (data) => {
    if (typeof data === 'string') {
      const f = JSON.parse(data) as { t: string }
      if (isFileFrame(f.t)) to.onFrame(f as Parameters<FileTransferEngine['onFrame']>[0])
      return
    }
    to.onChunk(data)
  }
}

function collectorSink(): FileSink & { chunks: ArrayBuffer[]; closed: boolean; aborted: boolean } {
  const sink = {
    kind: 'memory' as const,
    chunks: [] as ArrayBuffer[],
    closed: false,
    aborted: false,
    write(chunk: ArrayBuffer) {
      sink.chunks.push(chunk)
      return Promise.resolve()
    },
    close() {
      sink.closed = true
      return Promise.resolve()
    },
    abort() {
      sink.aborted = true
      return Promise.resolve()
    },
  }
  return sink
}

interface Rig {
  a: FakeChannel
  b: FakeChannel
  engineA: FileTransferEngine
  engineB: FileTransferEngine
  updatesA: BeamTransfer[]
  updatesB: BeamTransfer[]
  lastA(id: string): BeamTransfer | undefined
  lastB(id: string): BeamTransfer | undefined
}

function rig(): Rig {
  const a = new FakeChannel()
  const b = new FakeChannel()
  const updatesA: BeamTransfer[] = []
  const updatesB: BeamTransfer[] = []
  const engineA = new FileTransferEngine(a, (t) => updatesA.push(t))
  const engineB = new FileTransferEngine(b, (t) => updatesB.push(t))
  pipe(a, engineB)
  pipe(b, engineA)
  return {
    a, b, engineA, engineB, updatesA, updatesB,
    lastA: (id) => updatesA.filter((t) => t.id === id).at(-1),
    lastB: (id) => updatesB.filter((t) => t.id === id).at(-1),
  }
}

/** Make the channel read as full once N binary chunks have been sent, so the
 *  sender parks in its backpressure wait instead of finishing instantly. */
function parkAfterChunks(ch: FakeChannel, n: number): void {
  const originalSend = ch.send.bind(ch)
  ch.send = (data) => {
    originalSend(data)
    if (ch.sent.filter((d) => typeof d !== 'string').length === n) {
      ch.bufferedAmount = HIGH_WATER + 1
    }
  }
}

async function until(cond: () => boolean, what = 'condition', ms = 3000): Promise<void> {
  const start = Date.now()
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error(`timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 5))
  }
}

function testFile(bytes: number, name = 'photo.jpg'): { file: File; data: Uint8Array } {
  const data = new Uint8Array(bytes)
  for (let i = 0; i < bytes; i++) data[i] = (i * 31 + 7) & 0xff
  return { file: new File([data], name, { type: 'image/jpeg' }), data }
}

function joinChunks(chunks: ArrayBuffer[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.byteLength, 0)
  const out = new Uint8Array(total)
  let off = 0
  for (const c of chunks) { out.set(new Uint8Array(c), off); off += c.byteLength }
  return out
}

describe('a file crosses, byte for byte', () => {
  it('offer → accept → chunks → done, and the bytes match exactly', async () => {
    const r = rig()
    // 4½ chunks, so the last one is a partial — the off-by-one that matters.
    const { file, data } = testFile(Math.floor(CHUNK_SIZE * 4.5))
    const id = r.engineA.send(file)!
    expect(id).toBeTruthy()

    await until(() => r.lastB(id)?.status === 'offered', 'the offer to arrive')
    const offer = r.lastB(id)!
    expect(offer.name).toBe('photo.jpg')
    expect(offer.size).toBe(file.size)
    expect(offer.mime).toBe('image/jpeg')

    const sink = collectorSink()
    r.engineB.accept(id, sink)

    await until(() => r.lastB(id)?.status === 'done', 'the receive to finish')
    await until(() => r.lastA(id)?.status === 'done', 'the send to finish')

    expect(sink.closed).toBe(true)
    expect(joinChunks(sink.chunks)).toEqual(data)
    expect(r.lastB(id)!.bytes).toBe(file.size)
    expect(r.lastA(id)!.bytes).toBe(file.size)
  })

  it('a zero-byte file still completes', async () => {
    const r = rig()
    const id = r.engineA.send(new File([], 'empty.txt', { type: 'text/plain' }))!
    await until(() => r.lastB(id)?.status === 'offered', 'the offer')
    const sink = collectorSink()
    r.engineB.accept(id, sink)
    await until(() => r.lastB(id)?.status === 'done', 'completion')
    expect(sink.closed).toBe(true)
    expect(sink.chunks.length).toBe(0)
  })
})

describe('saying no', () => {
  it('decline reaches the sender, and the next queued file still goes', async () => {
    const r = rig()
    const first = r.engineA.send(testFile(CHUNK_SIZE, 'no-thanks.bin').file)!
    const second = r.engineA.send(testFile(CHUNK_SIZE, 'yes-please.bin').file)!

    // The second offer must NOT be on the table while the first is undecided.
    await until(() => r.lastB(first)?.status === 'offered', 'first offer')
    expect(r.lastA(second)?.status).toBe('queued')
    expect(r.lastB(second)).toBeUndefined()

    r.engineB.decline(first)
    await until(() => r.lastA(first)?.status === 'declined', 'the decline')

    await until(() => r.lastB(second)?.status === 'offered', 'second offer')
    const sink = collectorSink()
    r.engineB.accept(second, sink)
    await until(() => r.lastA(second)?.status === 'done', 'second file sent')
    expect(sink.closed).toBe(true)
  })

  it('the receiver can cancel mid-transfer and the sender stops', async () => {
    const r = rig()
    const { file } = testFile(CHUNK_SIZE * 40)
    const id = r.engineA.send(file)!
    await until(() => r.lastB(id)?.status === 'offered', 'the offer')

    // The fake channel has no latency, so an unchecked sender finishes the
    // whole file before the cancel can cross. Park it on backpressure after
    // five chunks — one past the progress-emit step, so the receiver's byte
    // count is visible — which is also the state a real cancel usually lands
    // in. The cancel itself must wake the parked loop (endOutgoing).
    parkAfterChunks(r.a, 5)

    const sink = collectorSink()
    r.engineB.accept(id, sink)
    await until(() => (r.lastB(id)?.bytes ?? 0) > 0, 'first bytes')
    r.engineB.cancel(id)

    await until(() => r.lastA(id)?.status === 'cancelled', 'sender to see the cancel')
    expect(r.lastB(id)!.status).toBe('cancelled')
    expect(sink.aborted).toBe(true)
    // The sender must not have pushed the whole file after the cancel.
    const sentBytes = r.a.sent.filter((d): d is ArrayBuffer => typeof d !== 'string')
      .reduce((n, c) => n + c.byteLength, 0)
    expect(sentBytes).toBeLessThan(file.size)
  })

  it('the sender can withdraw an offer the receiver has not answered', async () => {
    const r = rig()
    const id = r.engineA.send(testFile(CHUNK_SIZE).file)!
    await until(() => r.lastB(id)?.status === 'offered', 'the offer')
    r.engineA.cancel(id)
    await until(() => r.lastB(id)?.status === 'cancelled', 'the withdrawal')
    expect(r.lastA(id)!.status).toBe('cancelled')
  })

  it('a second simultaneous offer from a peer we do not understand is declined, not mixed in', async () => {
    const r = rig()
    const real = r.engineA.send(testFile(CHUNK_SIZE).file)!
    await until(() => r.lastB(real)?.status === 'offered', 'the real offer')
    // Hand-forge what our own engine would never send: a second offer while
    // one is still on the table.
    r.engineB.onFrame({ t: 'file-offer', id: 'forged', name: 'x.bin', size: 10, mime: '' })
    await until(() => r.b.sent.some((d) => typeof d === 'string' && d.includes('file-decline') && d.includes('forged')), 'the auto-decline')
    // The real offer is untouched.
    expect(r.lastB(real)!.status).toBe('offered')
  })
})

describe('backpressure', () => {
  it('stops reading when the buffer is full and resumes on bufferedamountlow', async () => {
    const a = new FakeChannel()
    const updates: BeamTransfer[] = []
    const engine = new FileTransferEngine(a, (t) => updates.push(t))
    const { file } = testFile(CHUNK_SIZE * 6)
    const id = engine.send(file)!

    // Fill the buffer the moment the second chunk is handed over.
    const originalSend = a.send.bind(a)
    a.send = (data) => {
      originalSend(data)
      const binary = a.sent.filter((d) => typeof d !== 'string').length
      if (binary === 2) a.bufferedAmount = HIGH_WATER + 1
    }

    engine.onFrame({ t: 'file-accept', id })
    await until(() => a.sent.filter((d) => typeof d !== 'string').length === 2, 'two chunks')

    // Give it every chance to misbehave: nothing more may be sent while the
    // buffer reads full.
    await new Promise((r) => setTimeout(r, 50))
    expect(a.sent.filter((d) => typeof d !== 'string').length).toBe(2)

    a.bufferedAmount = 0
    a.onbufferedamountlow?.(new Event('bufferedamountlow'))
    await until(() => updates.filter((t) => t.id === id).at(-1)?.status === 'done', 'completion after drain')
    expect(a.sent.filter((d) => typeof d !== 'string').length).toBe(6)
  })
})

describe('the channel dying', () => {
  it('fails everything in flight with a sentence, and aborts the sink', async () => {
    const r = rig()
    const { file } = testFile(CHUNK_SIZE * 40)
    const id = r.engineA.send(file)!
    await until(() => r.lastB(id)?.status === 'offered', 'the offer')

    // Park the sender mid-file, which also proves abortAll releases a parked
    // sender instead of leaving the loop hanging forever.
    parkAfterChunks(r.a, 5)

    const sink = collectorSink()
    r.engineB.accept(id, sink)
    await until(() => (r.lastB(id)?.bytes ?? 0) > 0, 'first bytes')

    r.engineA.abortAll('The connection closed before this finished.')
    r.engineB.abortAll('The connection closed before this finished.')

    expect(r.lastA(id)!.status).toBe('failed')
    expect(r.lastA(id)!.error).toMatch(/connection closed/)
    expect(r.lastB(id)!.status).toBe('failed')
    expect(sink.aborted).toBe(true)
  })

  it('send() refuses once the channel is closed', () => {
    const a = new FakeChannel()
    a.readyState = 'closed'
    const engine = new FileTransferEngine(a, () => {})
    expect(engine.send(testFile(10).file)).toBeNull()
  })
})

describe('hostile or malformed frames', () => {
  it('ignores offers with missing or nonsense fields', () => {
    const updates: BeamTransfer[] = []
    const engine = new FileTransferEngine(new FakeChannel(), (t) => updates.push(t))
    engine.onFrame({ t: 'file-offer', id: 'x' }) // no name, no size
    engine.onFrame({ t: 'file-offer', id: 'y', name: 'f', size: -5, mime: '' })
    expect(updates).toHaveLength(0)
  })

  it('bounds a hostile filename instead of trusting it', async () => {
    const updates: BeamTransfer[] = []
    const engine = new FileTransferEngine(new FakeChannel(), (t) => updates.push(t))
    engine.onFrame({ t: 'file-offer', id: 'z', name: 'A'.repeat(4000), size: 10, mime: '' })
    expect(updates[0].name).toHaveLength(255)
  })

  it('drops stray chunks arriving with no accepted transfer', () => {
    const engine = new FileTransferEngine(new FakeChannel(), () => {
      throw new Error('a stray chunk must not surface anywhere')
    })
    engine.onChunk(new ArrayBuffer(1024))
  })
})

describe('formatBytes', () => {
  it('reads like a human wrote it', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(999)).toBe('999 B')
    expect(formatBytes(64 * 1024)).toBe('64.0 KB')
    expect(formatBytes(3.2 * 1024 * 1024)).toBe('3.2 MB')
    expect(formatBytes(250 * 1024 * 1024)).toBe('250 MB')
    expect(formatBytes(2.1 * 1024 * 1024 * 1024)).toBe('2.1 GB')
  })
})
