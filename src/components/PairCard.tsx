import { useEffect, useState } from 'react'
import { joinUrl, useBeamStore } from '../stores/beamStore'
import { WAITING_NUDGE_MS } from '../lib/rtc'
import { isValidCode, normaliseCode } from '../lib/code'
import { writeClipboard } from '../lib/clipboard'
import BrandedQr from './BrandedQr'
import StatusPill from './StatusPill'

// The pairing half of the app: this device's code and QR on the left, "I have a
// code from another device" on the right.
//
// There is no "send or receive?" question to answer first, because the roles
// are symmetric once the data channel is up — either end can type. Making the
// user pick a role would be asking them to decide something the product does
// not actually need to know.
//
// The join half is folded away behind its own heading rather than removed: the
// common path is reading your own code aloud or scanning the square, so the
// entry field is one click away instead of competing with it. It stays a plain
// <details>, so the browser handles keyboard, focus and find-in-page for us.

export default function PairCard() {
  const code = useBeamStore((s) => s.code)
  const phase = useBeamStore((s) => s.phase)
  const joinedFromLink = useBeamStore((s) => s.joinedFromLink)
  const newCode = useBeamStore((s) => s.newCode)
  const joinCode = useBeamStore((s) => s.joinCode)

  const link = code ? joinUrl(code) : ''

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <section className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              {joinedFromLink ? 'Joining with this code' : 'Your code'}
            </h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              Open Beam on the other device and enter it, or scan the square.
            </p>
          </div>
          <StatusPill />
        </div>

        <p
          data-testid="pair-code"
          className="code-display mt-5 text-center text-3xl font-semibold text-slate-900 sm:text-4xl dark:text-slate-100"
        >
          {code || '······'}
        </p>

        {link && (
          <div className="mt-5 flex flex-col items-center gap-4">
            <div className="rounded-xl bg-white p-3 ring-1 ring-slate-200 dark:ring-slate-700">
              <BrandedQr value={link} />
            </div>
            <CopyButton
              text={link}
              idle="Copy the link"
              done="Link copied"
              testId="copy-link"
            />
          </div>
        )}

        <WaitingNudge />

        <button
          type="button"
          onClick={newCode}
          data-testid="new-code"
          className="mt-5 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          Start a new code
        </button>
      </section>

      <details
        data-testid="join-section"
        className="group h-fit rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-900"
      >
        <summary
          data-testid="join-toggle"
          className="flex cursor-pointer list-none items-center justify-between gap-3 outline-none focus-visible:ring-2 focus-visible:ring-orange-200 dark:focus-visible:ring-orange-900 [&::-webkit-details-marker]:hidden"
        >
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Got a code from the other device?
          </h2>
          <svg
            viewBox="0 0 20 20"
            aria-hidden="true"
            className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-open:rotate-180"
          >
            <path
              d="M5 7.5 10 12.5 15 7.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </summary>

        <p className="mt-3 text-sm text-slate-600 dark:text-slate-400">
          Type it here instead. Whichever device enters the other&rsquo;s code, the
          result is the same — once you are connected, either end can send.
        </p>
        <JoinForm onJoin={joinCode} busy={phase === 'pairing'} />

        <div className="mt-6 rounded-lg bg-slate-50 p-4 text-xs leading-relaxed text-slate-600 dark:bg-slate-800 dark:text-slate-400">
          <p className="font-medium text-slate-700 dark:text-slate-300">
            Both devices need the internet to find each other.
          </p>
          <p className="mt-1">
            Even sitting on the same Wi-Fi. A web page cannot look around your
            local network — no browser can — so the two tabs are introduced
            through a tiny rendezvous service that passes the connection code and
            nothing else. After that they talk directly and it drops out.
          </p>
        </div>
      </details>
    </div>
  )
}

function JoinForm({ onJoin, busy }: { onJoin: (code: string) => void; busy: boolean }) {
  const [value, setValue] = useState('')
  const cleaned = normaliseCode(value)
  const ready = isValidCode(cleaned)

  return (
    <form
      className="mt-4 flex flex-col gap-3 sm:flex-row"
      onSubmit={(e) => {
        e.preventDefault()
        if (ready) onJoin(cleaned)
      }}
    >
      <input
        type="text"
        inputMode="text"
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        maxLength={9}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="ABC234"
        aria-label="Code from the other device"
        data-testid="join-input"
        className="code-display min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-center text-lg uppercase text-slate-900 outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-200 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-orange-900"
      />
      <button
        type="submit"
        disabled={!ready || busy}
        data-testid="join-submit"
        className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-orange-700 disabled:cursor-not-allowed disabled:bg-slate-300 dark:disabled:bg-slate-700"
      >
        Connect
      </button>
    </form>
  )
}

/** Waiting has no deadline — someone can legitimately leave the code on screen
 *  while they walk to another room. So we never time out the wait; after a
 *  while we just gently suggest the obvious thing, without implying failure. */
function WaitingNudge() {
  const phase = useBeamStore((s) => s.phase)
  const [nudge, setNudge] = useState(false)

  useEffect(() => {
    if (phase !== 'waiting') {
      setNudge(false)
      return
    }
    const t = setTimeout(() => setNudge(true), WAITING_NUDGE_MS)
    return () => clearTimeout(t)
  }, [phase])

  if (!nudge || phase !== 'waiting') return null
  return (
    <p className="mt-5 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800 dark:bg-amber-950 dark:text-amber-200">
      Still nobody. The code stays valid for as long as this tab is open, so
      there is no rush — but if the other device has already entered it, check
      the characters match and that it has an internet connection.
    </p>
  )
}

function CopyButton({
  text,
  idle,
  done,
  testId,
}: {
  text: string
  idle: string
  done: string
  testId?: string
}) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1800)
    return () => clearTimeout(t)
  }, [copied])

  return (
    <button
      type="button"
      data-testid={testId}
      onClick={() => { void writeClipboard(text).then(setCopied) }}
      className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
    >
      {copied ? done : idle}
    </button>
  )
}
