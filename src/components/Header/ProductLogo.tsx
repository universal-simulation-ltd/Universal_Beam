// Universal Beam brand icon — icon-only by design. The SDK's
// UniversalAppsNavBar renders the product name beside this slot (from the apps
// catalogue), so putting a wordmark here would print the name twice.
//
// Two dots and a line: the whole product is a direct link between exactly two
// points, which is what a data channel is.
export default function ProductLogo() {
  return (
    <span
      className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-orange-600 text-white"
      aria-hidden="true"
    >
      <svg viewBox="0 0 16 16" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="3.2" cy="8" r="1.5" fill="currentColor" stroke="none" />
        <circle cx="12.8" cy="8" r="1.5" fill="currentColor" stroke="none" />
        <path d="M5.4 8h3.6" />
        <path d="m8.4 6.2 1.8 1.8-1.8 1.8" />
      </svg>
    </span>
  )
}
