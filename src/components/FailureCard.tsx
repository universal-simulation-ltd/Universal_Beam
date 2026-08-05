import { useState } from 'react'
import { useBeamStore } from '../stores/beamStore'
import { writeClipboard } from '../lib/clipboard'

// Universal Beam is DIRECT-OR-FAIL: there is no paid TURN relay behind a failed
// ICE negotiation, so on some networks two devices genuinely cannot reach each
// other. That is a deliberate trade — a relay would see only ciphertext, but it
// would also be an uncapped bandwidth bill, and "no server ever holds your
// text" would need an asterisk.
//
// Given that, this card is the single most important screen in the app. A
// spinner that never resolves teaches a user the product is broken; a sentence
// naming the cause and one thing to try costs us a transfer and keeps their
// trust. Every word here comes from evidence collected during the negotiation
// (lib/diagnose.ts), never from a guess — where we don't know, it says so.

export default function FailureCard() {
  const failure = useBeamStore((s) => s.failure)
  const retry = useBeamStore((s) => s.connect)
  const newCode = useBeamStore((s) => s.newCode)
  const [showTechnical, setShowTechnical] = useState(false)
  const [copied, setCopied] = useState(false)

  if (!failure) return null

  return (
    <section
      data-testid="failure"
      role="alert"
      className="rounded-2xl border border-rose-200 bg-rose-50 p-6 dark:border-rose-900 dark:bg-rose-950/50"
    >
      <h2 className="text-base font-semibold text-rose-900 dark:text-rose-100">
        {failure.headline}
      </h2>
      <p className="mt-2 max-w-prose text-sm leading-relaxed text-rose-900/90 dark:text-rose-100/90">
        {failure.explain}
      </p>

      {failure.fixes.length > 0 && (
        <>
          <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-rose-800/80 dark:text-rose-200/80">
            Worth trying
          </p>
          <ul className="mt-2 space-y-1.5 text-sm text-rose-900/90 dark:text-rose-100/90">
            {failure.fixes.map((fix) => (
              <li key={fix} className="flex gap-2">
                <span aria-hidden className="select-none">•</span>
                <span>{fix}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="mt-5 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={retry}
          data-testid="retry"
          className="rounded-lg bg-rose-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-800"
        >
          Try the same code again
        </button>
        <button
          type="button"
          onClick={newCode}
          className="rounded-lg border border-rose-300 px-4 py-2 text-sm font-medium text-rose-900 transition hover:bg-rose-100 dark:border-rose-800 dark:text-rose-100 dark:hover:bg-rose-900/50"
        >
          Start a new code
        </button>
      </div>

      <div className="mt-5 border-t border-rose-200 pt-3 dark:border-rose-900">
        <button
          type="button"
          onClick={() => setShowTechnical((v) => !v)}
          className="text-xs font-medium text-rose-800/80 underline-offset-2 hover:underline dark:text-rose-200/80"
        >
          {showTechnical ? 'Hide technical details' : 'Technical details'}
        </button>
        {showTechnical && (
          <div className="mt-2">
            <code className="block overflow-x-auto rounded-md bg-white/70 px-3 py-2 font-mono text-[11px] leading-relaxed text-rose-900 dark:bg-black/30 dark:text-rose-100">
              {failure.technical}
            </code>
            <button
              type="button"
              onClick={() => { void writeClipboard(failure.technical).then(setCopied) }}
              className="mt-2 text-xs font-medium text-rose-800/80 underline-offset-2 hover:underline dark:text-rose-200/80"
            >
              {copied ? 'Copied' : 'Copy for a bug report'}
            </button>
          </div>
        )}
      </div>
    </section>
  )
}
