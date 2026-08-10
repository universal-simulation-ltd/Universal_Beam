// Where a received file goes — and the per-browser honesty that goes with it.
//
// Chrome and Edge have the File System Access API: the user picks a
// destination when they accept, and every chunk is streamed to disk as it
// arrives. A 20 GB file costs 64 KiB of memory at a time.
//
// Safari and Firefox have no such API. There the whole file accumulates in
// memory and is handed to the browser as a download when the last chunk lands
// — which works, and quietly stops working somewhere around the size of the
// device's free RAM. That ceiling is stated in the UI *before* the transfer
// (see Room.tsx), not discovered at 94% of a 3 GB file. §13.4 of
// next-products.md calls this the trap of the receive side, and it is.

import type { FileSink } from './files'

// The File System Access API is WICG, not yet in TypeScript's dom lib.
interface SaveFilePickerOptions {
  suggestedName?: string
}
interface WritableLike {
  write(data: ArrayBuffer): Promise<void>
  close(): Promise<void>
  abort(): Promise<void>
}
interface FileHandleLike {
  createWritable(): Promise<WritableLike>
}
declare global {
  interface Window {
    showSaveFilePicker?: (options?: SaveFilePickerOptions) => Promise<FileHandleLike>
  }
}

/** True where a received file can stream to disk instead of filling RAM.
 *  `typeof`, not `in` — tests knock the API out by assigning undefined. */
export function supportsStreamingSave(): boolean {
  return typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function'
}

/** Files at or above this, on a browser without streaming save, get a plain
 *  warning on the offer row. There is no exact ceiling — it is "your free
 *  RAM" — so the number is deliberately conservative: transfers this size
 *  deserve the warning even on a well-provisioned machine. */
export const MEMORY_WARN_BYTES = 512 * 1024 * 1024

/** Open the save dialog and return a sink that streams to the chosen file.
 *  MUST be called directly from the accepting click — the picker needs the
 *  user's activation. Returns null if the user cancels the dialog, which the
 *  caller should treat as declining the offer. */
export async function createDiskSink(name: string): Promise<FileSink | null> {
  let writable: WritableLike
  try {
    const handle = await window.showSaveFilePicker!({ suggestedName: name })
    writable = await handle.createWritable()
  } catch {
    // AbortError: the user closed the picker. Anything else (a blocked
    // directory, an iframe policy) lands here too, and "treat as declined"
    // is still the honest outcome the sender can act on.
    return null
  }
  return {
    kind: 'disk',
    write: (chunk) => writable.write(chunk),
    close: () => writable.close(),
    abort: async () => { try { await writable.abort() } catch { /* already gone */ } },
  }
}

/** The fallback: hold the chunks, then hand the browser a download. */
export function createMemorySink(name: string, mime: string): FileSink {
  let chunks: ArrayBuffer[] = []
  return {
    kind: 'memory',
    write: (chunk) => {
      chunks.push(chunk)
      return Promise.resolve()
    },
    close: () => {
      const blob = new Blob(chunks, { type: mime || 'application/octet-stream' })
      chunks = []
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = name
      document.body.appendChild(a)
      a.click()
      a.remove()
      // The revoke waits long enough for the download to begin; revoking
      // immediately races the click in Safari.
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
      return Promise.resolve()
    },
    abort: () => {
      chunks = []
      return Promise.resolve()
    },
  }
}
