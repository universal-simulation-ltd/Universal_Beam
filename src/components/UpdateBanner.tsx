import { joinUrl, useBeamStore } from '../stores/beamStore'

// "This tab is running yesterday's Beam."
//
// The service worker hands back the cached shell FIRST, so a device that has
// been here before runs the build it cached for the whole of its next visit.
// That is not a theoretical staleness: Beam shipped text-only on 2026-08-06 and
// files on 2026-08-10, and a device holding the older one silently dropped
// every file offer sent to it — the sender just sat on "Waiting for the other
// device to accept". Nothing on screen said why, on either end.
//
// ⚠️ Deliberately NOT an automatic reload, even though the new worker has
// already taken over. Reloading mid-session tears down a live data channel, and
// reloading while WAITING would mint a fresh code and quietly invalidate the QR
// someone is halfway across the house to scan. The user picks the moment; we
// only make sure they know there is a moment to pick.
export default function UpdateBanner() {
  const updateReady = useBeamStore((s) => s.updateReady)
  const code = useBeamStore((s) => s.code)

  if (!updateReady) return null

  // Carry the code through the reload. Without this, a reload with no ?c= mints
  // a new one, and the code the user has already read out becomes wrong.
  function reload() {
    if (code) window.location.replace(joinUrl(code))
    else window.location.reload()
  }

  return (
    <div
      role="status"
      data-testid="update-banner"
      className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900 dark:bg-amber-950"
    >
      <p className="min-w-0 flex-1 text-sm leading-relaxed text-amber-900 dark:text-amber-100">
        A newer version of Beam is ready. This tab is still running the old one —
        reload to pick it up, or the other device may not be able to send you
        files.
      </p>
      <button
        type="button"
        onClick={reload}
        data-testid="update-reload"
        className="shrink-0 rounded-lg bg-orange-700 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-orange-800"
      >
        Reload
      </button>
    </div>
  )
}
