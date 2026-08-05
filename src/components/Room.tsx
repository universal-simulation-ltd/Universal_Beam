import { useEffect, useRef, useState } from 'react'
import { useBeamStore } from '../stores/beamStore'
import { asSingleLink, canReadClipboard, readClipboard, writeClipboard } from '../lib/clipboard'
import StatusPill from './StatusPill'

// The connected view. Everything on this screen lives in memory in these two
// tabs and nowhere else: there is no history, no sync and no server-side copy,
// so closing the tab really is the delete button. The copy says so, because a
// user who assumes otherwise will be unpleasantly surprised later rather than
// now.

export default function Room() {
  const messages = useBeamStore((s) => s.messages)
  const route = useBeamStore((s) => s.route)
  const phase = useBeamStore((s) => s.phase)
  const send = useBeamStore((s) => s.send)
  const disconnect = useBeamStore((s) => s.disconnect)

  const live = phase === 'connected'
  const listEnd = useRef<HTMLDivElement>(null)

  useEffect(() => {
    listEnd.current?.scrollIntoView({ block: 'end', behavior: 'smooth' })
  }, [messages.length])

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-900">
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
          </div>
          <StatusPill />
        </div>

        <Composer disabled={!live} onSend={send} />
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

        {messages.length === 0 ? (
          <p className="mt-4 rounded-lg bg-slate-50 px-4 py-6 text-center text-sm text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            Nothing sent yet. Type or paste above, and it appears on the other
            device straight away.
          </p>
        ) : (
          <ul className="mt-4 max-h-[26rem] space-y-3 overflow-y-auto pr-1">
            {messages.map((m) => (
              <MessageRow key={m.id} body={m.body} dir={m.dir} at={m.at} />
            ))}
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

function Composer({ disabled, onSend }: { disabled: boolean; onSend: (body: string) => boolean }) {
  const [draft, setDraft] = useState('')
  const [pasteHint, setPasteHint] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)

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
          Enter sends · Shift+Enter for a new line
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
