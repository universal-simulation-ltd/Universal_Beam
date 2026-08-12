import { useEffect, useState } from 'react'
import BrandedQr from './BrandedQr'

// The pairing QR, filled to the screen with the page dimmed behind it, so the
// other device can read it from across a desk rather than from 8cm away.
//
// Deliberately the same shape as Universal QR's EnlargeModal — dimmed backdrop,
// click anywhere to dismiss, Escape, a hint down each side, and the code itself
// on a white plate that swallows its own clicks so a phone held against the
// screen doesn't close it. Two apps showing a code to scan should behave the
// same way; the copy differs because the codes do different jobs.
//
// The plate stays WHITE in dark mode. A QR is not a UI element — it is
// something a camera has to decode, and the modules are near-black. Inverting
// it for the theme would cost scans on the exact devices most likely to be in
// a dark room.

/** Rendered edge in px. Big enough to be crisp on the plate, clamped so it
 *  never overflows a phone in landscape. The SVG is regenerated at this size
 *  rather than scaled up with CSS, which would soften the finder eyes. */
function enlargedSize() {
  if (typeof window === 'undefined') return 480
  return Math.round(Math.max(240, Math.min(720, window.innerWidth * 0.82, window.innerHeight * 0.62)))
}

export default function EnlargeQrModal({ value, onClose }: { value: string; onClose: () => void }) {
  const [size, setSize] = useState(enlargedSize)

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    function onResize() { setSize(enlargedSize()) }
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onResize)
    }
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-5 bg-slate-900/80 p-4 backdrop-blur-sm sm:p-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Enlarged pairing QR code"
      data-testid="qr-enlarged"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        data-testid="qr-enlarged-close"
        className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-xl leading-none text-white transition hover:bg-white/25"
      >
        ×
      </button>

      {/* Dismiss hints down each side — the whole backdrop is clickable. */}
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs font-medium tracking-wide text-white/60 sm:left-6">
        Click to dismiss
      </span>
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium tracking-wide text-white/60 sm:right-6">
        Click to dismiss
      </span>

      <div
        className="rounded-2xl bg-white p-4 shadow-lg ring-1 ring-slate-200"
        onClick={(e) => e.stopPropagation()}
      >
        <BrandedQr value={value} size={size} testId="pair-qr-enlarged" />
      </div>

      <div className="max-w-md text-center">
        <p className="text-sm font-semibold text-white">
          Point the other device&rsquo;s camera at this code
        </p>
        <p className="mt-1 text-xs text-white/70">
          It opens Beam already joined to this session. Struggling? Turn your screen
          brightness up, and pull the camera back a little so the whole code is in frame.
        </p>
      </div>
    </div>
  )
}
