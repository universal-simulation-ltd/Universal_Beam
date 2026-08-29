// GENERATED FILE — do not edit by hand.
// Source: backoffice/universal-platform/scripts/app-marks/marks.mjs
// Regenerate: node scripts/app-marks/build.mjs (from backoffice/universal-platform)
// Mark: Universal Beam — Two devices and the beam between them.
// Hover: The beam crosses from the near device to the far one.
//
// Icon-only by design: the SDK's UniversalAppsNavBar renders the product name
// from its catalogue beside this slot, so a wordmark here would print it twice.

const CSS = `
  /* Resting states */
  .uam-beam-beam { transform: translateX(-6px); opacity: 0.35; transition: transform .5s cubic-bezier(0.16,1,0.3,1), opacity .4s ease; }

  /* Active states */
  .uam-host-beam:hover .uam-beam-beam,
  .uam-host-beam:focus-visible .uam-beam-beam { transform: translateX(0); opacity: 1; }

  @media (prefers-reduced-motion: reduce) {
    .uam-beam-beam { transition: none !important; }
  }
`

export default function ProductLogo() {
  return (
    <span
      className="uam-host-beam inline-flex h-6 w-6 shrink-0 items-center justify-center"
      aria-hidden="true"
    >
      <style>{CSS}</style>
      <svg viewBox="0 0 64 64" className="h-6 w-6" aria-hidden="true">
        <defs>
          <linearGradient id="uam-nav-beam-tile" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#fe8c01" />
            <stop offset="1" stopColor="#e05504" />
          </linearGradient>
        </defs>
        <rect width="64" height="64" rx="14" fill="url(#uam-nav-beam-tile)" />
        <rect x={6} y={16} width={15} height={32} rx={4} fill="#fed7aa" />
        <rect x={43} y={16} width={15} height={32} rx={4} fill="#fed7aa" />
        <g fill="none" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" stroke="#ffffff" className="uam-beam-beam">
          <path d="M26 32h11" />
          <path d="M33.5 27.5 38 32l-4.5 4.5" />
        </g>
      </svg>
    </span>
  )
}
