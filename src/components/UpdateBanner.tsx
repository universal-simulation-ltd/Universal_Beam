import { UpdateNotice } from '@unisim/sdk'
import { joinUrl, useBeamStore } from '../stores/beamStore'

// "This tab is running yesterday's Beam."
//
// The detection lives in the SDK now (`useAppUpdate`, which `UpdateNotice`
// wraps) because it is true of every Universal App, not just this one: an
// `autoUpdate` PWA hands the new worker control the moment it installs, but the
// page already running keeps the JavaScript it loaded, for its whole visit.
//
// Beam only supplies the two things that ARE local to it:
//
//  * **Why a stale tab matters here specifically.** Elsewhere it is merely old.
//    Here the two ends must agree on a protocol, and the build from before
//    files drops a file offer without a word — so the sender waits forever on
//    an accept that cannot come.
//  * **A reload that keeps the pairing code.** A bare `location.reload()` lands
//    on a page with no `?c=`, which mints a FRESH code — quietly invalidating
//    the one already read out to someone, or printed in the QR on screen.
//
// ⚠️ Still deliberately not automatic. Reloading mid-session tears down a live
// data channel, and reloading while waiting would swap the code out from under
// somebody walking across the house to scan it. The user picks the moment.
export default function UpdateBanner() {
  const code = useBeamStore((s) => s.code)

  return (
    <UpdateNotice
      className="rounded-2xl"
      message="A newer version of Beam is ready. This tab is still running the old one — reload to pick it up, or the other device may not be able to send you files."
      onReload={() => {
        if (code) window.location.replace(joinUrl(code))
        else window.location.reload()
      }}
    />
  )
}
