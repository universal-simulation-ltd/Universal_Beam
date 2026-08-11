import { useEffect, useRef, useState } from 'react'
import { useFileDrop } from '@unisim/sdk'
import { useBeamStore } from '../stores/beamStore'
import { asSingleLink, canReadClipboard, readClipboard, writeClipboard } from '../lib/clipboard'
import { formatBytes, type BeamTransfer } from '../lib/files'
import { MEMORY_WARN_BYTES, supportsStreamingSave } from '../lib/fileSink'
import StatusPill from './StatusPill'

// The connected view. Everything on this screen lives in memory in these two
// tabs and nowhere else: there is no history, no sync and no server-side copy,
// so closing the tab really is the delete button. The copy says so, because a
// user who assumes otherwise will be unpleasantly surprised later rather than
// now.
//
// Text and files share one timeline, ordered by when they happened — a file is
// something that was sent, not a different app bolted on the side.

type TimelineItem =
  | { kind: 'msg'; key: string; at: number; body: string; dir: 'in' | 'out' }
  | { kind: 'file'; key: string; at: number; t: BeamTransfer }

export default function Room() {
  const messages = useBeamStore((s) => s.messages)
  const transfers = useBeamStore((s) => s.transfers)
  const route = useBeamStore((s) => s.route)
  const phase = useBeamStore((s) => s.phase)
  const sas = useBeamStore((s) => s.sas)
  const send = useBeamStore((s) => s.send)
  const sendFiles = useBeamStore((s) => s.sendFiles)
  const disconnect = useBeamStore((s) => s.disconnect)

  const live = phase === 'connected'
  const listEnd = useRef<HTMLDivElement>(null)

  // `clickToBrowse` off: this zone is the whole connected panel, and it already
  // contains a textarea and four buttons — making it one big button too would be
  // ambiguous for a mouse and wrong for a screen reader. The panel takes drops;
  // "Send a file" below opens the picker.
  const drop = useFileDrop({
    onFiles: sendFiles,
    clickToBrowse: false,
    disabled: !live,
  })

  const timeline: TimelineItem[] = [
    ...messages.map((m): TimelineItem => ({ kind: 'msg', key: `m-${m.id}`, at: m.at, body: m.body, dir: m.dir })),
    ...Object.values(transfers).map((t): TimelineItem => ({ kind: 'file', key: `f-${t.id}`, at: t.at, t })),
  ].sort((a, b) => a.at - b.at)

  useEffect(() => {
    listEnd.current?.scrollIntoView({ block: 'end', behavior: 'smooth' })
  }, [timeline.length])

  return (
    <div className="space-y-6">
      <section
        {...drop.dropzoneProps}
        className={`rounded-2xl border bg-white p-6 transition dark:bg-slate-900 ${
          drop.over
            ? 'border-orange-400 ring-2 ring-orange-200 dark:ring-orange-900'
            : 'border-slate-200 dark:border-slate-700'
        }`}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              {live ? 'Connected' : 'Session ended'}
            </h2>
            <p className="mt-1 max-w-prose text-sm text-slate-600 dark:text-slate-400">
              {route?.detail ??
                (live
                  ? 'Connected peer-to-peer.'
                  : 'The other device disconnected. Anything below stays on screen until you close the tab.')}
            </p>
            {live && sas && (
              <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                Safety check: both devices should show{' '}
                <strong data-testid="sas" className="code-display font-semibold text-slate-700 dark:text-slate-200">
                  {sas}
                </strong>
                {' '}— if they differ, something is sitting between you. Worth a
                glance before sending anything sensitive.
              </p>
            )}
          </div>
          <StatusPill />
        </div>

        <Composer disabled={!live} onSend={send} onSendFiles={sendFiles} />
      </section>

      <section
        data-testid="messages"
        aria-live="polite"
        className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6 dark:border-slate-700 dark:bg-slate-900"
      >
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">This session</h2>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            Kept in this tab only — never uploaded, never saved
          </span>
        </div>

        {timeline.length === 0 ? (
          <p className="mt-4 rounded-lg bg-slate-50 px-4 py-6 text-center text-sm text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            Nothing sent yet. Type or paste above — or send a file — and it
            appears on the other device straight away.
          </p>
        ) : (
          <ul className="mt-4 max-h-[26rem] space-y-3 overflow-y-auto pr-1">
            {timeline.map((item) =>
              item.kind === 'msg' ? (
                <MessageRow key={item.key} body={item.body} dir={item.dir} at={item.at} />
              ) : (
                <TransferRow key={item.key} t={item.t} />
              ),
            )}
            <div ref={listEnd} />
          </ul>
        )}
      </section>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={disconnect}
          data-testid="disconnect"
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          {live ? 'Disconnect' : 'Start over'}
        </button>
      </div>
    </div>
  )
}

function Composer({
  disabled,
  onSend,
  onSendFiles,
}: {
  disabled: boolean
  onSend: (body: string) => boolean
  onSendFiles: (files: Iterable<File>) => void
}) {
  const [draft, setDraft] = useState('')
  const [pasteHint, setPasteHint] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)
  // Only the input and `open()` are used here — the drop target is the whole
  // panel above, not this row of buttons.
  const picker = useFileDrop({ onFiles: onSendFiles, clickToBrowse: false, disabled })

  function submit() {
    if (disabled) return
    if (onSend(draft)) setDraft('')
  }

  async function paste() {
    const text = await readClipboard()
    if (text === null) {
      // Firefox has no readText() at all, and elsewhere the user can decline.
      // Say what to press instead of failing silently.
      setPasteHint(true)
      ref.current?.focus()
      return
    }
    setPasteHint(false)
    setDraft((d) => (d ? `${d}\n${text}` : text))
    ref.current?.focus()
  }

  return (
    <div className="mt-5">
      <textarea
        ref={ref}
        value={draft}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            submit()
          }
        }}
        rows={4}
        placeholder="Type or paste anything — a note, a link, a code…"
        aria-label="Text to send"
        data-testid="composer"
        className="w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-200 disabled:bg-slate-50 disabled:text-slate-400 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-orange-900 dark:disabled:bg-slate-900"
      />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={disabled || !draft.trim()}
          data-testid="send"
          className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-orange-700 disabled:cursor-not-allowed disabled:bg-slate-300 dark:disabled:bg-slate-700"
        >
          Send
        </button>
        <input {...picker.inputProps} className="hidden" data-testid="file-input" />
        <button
          type="button"
          onClick={picker.open}
          disabled={disabled}
          data-testid="send-file"
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          Send a file
        </button>
        {canReadClipboard() && (
          <button
            type="button"
            onClick={() => { void paste() }}
            disabled={disabled}
            data-testid="paste"
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Paste from clipboard
          </button>
        )}
        <span className="ml-auto text-xs text-slate-400 dark:text-slate-500">
          Enter sends · Shift+Enter for a new line · drop a file anywhere here
        </span>
      </div>

      {pasteHint && (
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          Your browser would not hand over the clipboard — press Ctrl/Cmd-V in
          the box above instead. (Beam never reads your clipboard on its own; no
          web page can.)
        </p>
      )}
    </div>
  )
}

function MessageRow({ body, dir, at }: { body: string; dir: 'in' | 'out'; at: number }) {
  const [copied, setCopied] = useState(false)
  const link = asSingleLink(body)

  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1800)
    return () => clearTimeout(t)
  }, [copied])

  const time = new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  return (
    <li
      data-testid={dir === 'in' ? 'message-in' : 'message-out'}
      className={`rounded-xl border px-4 py-3 ${
        dir === 'in'
          ? 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/40'
          : 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/60'
      }`}
    >
      <div className="flex items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400">
        <span className="font-medium">{dir === 'in' ? 'Received' : 'Sent'}</span>
        <span>{time}</span>
      </div>
      <p className="mt-1.5 break-words whitespace-pre-wrap text-sm text-slate-900 dark:text-slate-100">
        {body}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => { void writeClipboard(body).then(setCopied) }}
          className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 transition hover:bg-white dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
        {link && (
          <a
            href={link}
            target="_blank"
            rel="noreferrer noopener"
            className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 transition hover:bg-white dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Open link
          </a>
        )}
      </div>
    </li>
  )
}

// One file transfer, whatever state it is in. The row IS the progress UI, the
// accept prompt and the receipt, so a transfer never jumps around the screen
// as it moves through its life.
function TransferRow({ t }: { t: BeamTransfer }) {
  const acceptTransfer = useBeamStore((s) => s.acceptTransfer)
  const declineTransfer = useBeamStore((s) => s.declineTransfer)
  const cancelTransfer = useBeamStore((s) => s.cancelTransfer)

  const time = new Date(t.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const pct = t.size > 0 ? Math.min(100, Math.round((t.bytes / t.size) * 100)) : 100
  const incomingOffer = t.dir === 'in' && t.status === 'offered'
  // The Firefox/Safari honesty: no streaming save means the whole file sits in
  // memory until it is handed over as a download. Say so BEFORE the transfer.
  const memoryWarning = incomingOffer && !supportsStreamingSave() && t.size >= MEMORY_WARN_BYTES

  const statusLine: string =
    t.status === 'queued' ? 'Waiting for the current transfer to finish'
    : t.status === 'offered' ? (t.dir === 'out' ? 'Waiting for the other device to accept' : 'The other device wants to send you this file')
    : t.status === 'active' ? `${formatBytes(t.bytes)} of ${formatBytes(t.size)}`
    : t.status === 'done' ? (t.dir === 'out' ? 'Sent' : t.savedAs === 'disk' ? 'Saved where you chose' : 'Done — check your downloads')
    : t.status === 'declined' ? (t.dir === 'out' ? 'The other device declined' : 'Declined')
    : t.status === 'cancelled' ? 'Cancelled'
    : t.error ?? 'Failed'

  return (
    <li
      data-testid={t.dir === 'in' ? 'transfer-in' : 'transfer-out'}
      data-status={t.status}
      className={`rounded-xl border px-4 py-3 ${
        t.dir === 'in'
          ? 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/40'
          : 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/60'
      }`}
    >
      <div className="flex items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400">
        <span className="font-medium">{t.dir === 'in' ? 'Incoming file' : 'Sending file'}</span>
        <span>{time}</span>
      </div>

      <p className="mt-1.5 flex flex-wrap items-baseline gap-x-2 text-sm">
        <span className="min-w-0 break-all font-medium text-slate-900 dark:text-slate-100">{t.name}</span>
        <span className="text-xs text-slate-500 dark:text-slate-400">{formatBytes(t.size)}</span>
      </p>

      {t.status === 'active' && (
        <div className="mt-2" data-testid="transfer-progress">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
            <div
              className="h-full rounded-full bg-orange-500 transition-[width] duration-200"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}

      <p
        className={`mt-1.5 text-xs ${
          t.status === 'failed'
            ? 'text-rose-700 dark:text-rose-300'
            : 'text-slate-600 dark:text-slate-400'
        }`}
      >
        {statusLine}
      </p>

      {memoryWarning && (
        <p className="mt-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800 dark:bg-amber-950 dark:text-amber-200">
          This browser cannot stream a file to disk, so the whole{' '}
          {formatBytes(t.size)} sits in memory until it lands in your downloads.
          A file this size may fail partway — Chrome or Edge would save it
          straight to disk instead.
        </p>
      )}

      <div className="mt-2 flex flex-wrap gap-2">
        {incomingOffer && (
          <>
            <button
              type="button"
              onClick={() => { void acceptTransfer(t.id) }}
              data-testid="accept-file"
              className="rounded-md bg-orange-600 px-3 py-1 text-xs font-semibold text-white transition hover:bg-orange-700"
            >
              {supportsStreamingSave() ? 'Save…' : 'Accept'}
            </button>
            <button
              type="button"
              onClick={() => declineTransfer(t.id)}
              data-testid="decline-file"
              className="rounded-md border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600 transition hover:bg-white dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Decline
            </button>
          </>
        )}
        {(t.status === 'active' || t.status === 'queued' || (t.dir === 'out' && t.status === 'offered')) && (
          <button
            type="button"
            onClick={() => cancelTransfer(t.id)}
            data-testid="cancel-file"
            className="rounded-md border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600 transition hover:bg-white dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Cancel
          </button>
        )}
      </div>
    </li>
  )
}
