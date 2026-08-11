// The limitations, on the page rather than in a support article somewhere.
// Folded shut by default to keep the pairing screen short, but folded — not
// trimmed, not softened: every claim is one click away, and the list below
// stays complete regardless of how much of it is on screen at rest.
//
// Every claim here is scoped to the leg the user is actually on — the standing
// suite rule. Three sentences are deliberately absent, and must stay absent:
//
//   "Never leaves your network"  — false the moment the two devices are on
//                                  different networks, which is supported.
//   "No servers involved"        — a rendezvous server is always involved.
//   "Works offline"              — pairing needs the internet, always, even on
//                                  one Wi-Fi. This is the product's real limit.
//
// The LocalSend pointer is not modesty. If someone needs two laptops in a field
// with no internet, this app cannot do it and LocalSend can; sending them there
// costs nothing and is what makes the rest of the claims on this page credible.

const ITEMS: { title: string; body: string }[] = [
  {
    title: 'Your text and files go device to device',
    body:
      'Once the two tabs are connected they talk directly. Everything you send is encrypted end to end by the browser itself, and no server of ours ever holds any of it — there is nothing to leak, subpoena or delete later.',
  },
  {
    title: 'A server does help you pair — and only pair',
    body:
      'Two browsers cannot find each other unaided, so both dial out to a small rendezvous service that matches them by code and passes the connection details. It never sees what you send, and Beam hangs up on it seconds after the direct link opens.',
  },
  {
    title: 'Both devices need the internet, even on the same Wi-Fi',
    body:
      'This is the honest limitation. A web page cannot browse your local network — no browser can, by design — so pairing always goes out to the internet and back. If you need transfers with no internet at all, use LocalSend: it is free, open source, and better at that than we can be in a tab.',
  },
  {
    title: 'Some networks will not allow a direct connection',
    body:
      'Beam is direct-or-fail. Where a router, carrier or corporate firewall blocks peer-to-peer traffic, Beam tells you so in plain words instead of spinning — it will not quietly bounce your data through a relay to hide the problem. Putting both devices on the same Wi-Fi fixes it nearly every time.',
  },
  {
    title: 'How big a file can be depends on the receiving browser',
    body:
      'On Chrome and Edge the receiver picks where to save and the file streams straight to disk, so size barely matters. Safari and Firefox give a web page no way to do that: the whole file sits in memory until it lands in the downloads folder, so very large transfers can fail there. Beam warns on the offer itself when that risk is real.',
  },
  {
    title: 'Nothing is remembered',
    body:
      'No account, no history, no sync, no "send to a device that is switched off". What is on screen lives in these two tabs; closing one is the delete button. Reopening Beam starts an empty session with a new code.',
  },
  {
    title: 'It cannot mirror your clipboard',
    body:
      'A web page has no way to watch your clipboard in the background, so Beam will never claim to sync it. Sending is always something you press. That is a browser limit, not a feature we skipped.',
  },
]

export default function Honesty() {
  return (
    <details
      data-testid="honesty-section"
      className="group rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-900"
    >
      <summary
        data-testid="honesty-toggle"
        className="flex cursor-pointer list-none items-center justify-between gap-3 outline-none focus-visible:ring-2 focus-visible:ring-orange-200 dark:focus-visible:ring-orange-900 [&::-webkit-details-marker]:hidden"
      >
        <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
          What Beam does, and what it cannot do
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
      <dl className="mt-4 grid gap-x-8 gap-y-5 sm:grid-cols-2">
        {ITEMS.map((item) => (
          <div key={item.title}>
            <dt className="text-sm font-medium text-slate-900 dark:text-slate-100">{item.title}</dt>
            <dd className="mt-1 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
              {item.body}
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-5 text-xs text-slate-500 dark:text-slate-400">
        Need transfers with no internet at all?{' '}
        <a
          href="https://localsend.org"
          target="_blank"
          rel="noreferrer noopener"
          className="font-medium text-slate-700 underline underline-offset-2 hover:text-orange-600 dark:text-slate-300"
        >
          LocalSend
        </a>{' '}
        is the right tool, and it is free.
      </p>
    </details>
  )
}
