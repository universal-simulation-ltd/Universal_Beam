import { useEffect } from 'react'
import { UniversalAppsNavBar } from '@unisim/sdk'
import UsageTracker from './UsageTracker'
import AppMenu from './components/Header/AppMenu'
import ProductLogo from './components/Header/ProductLogo'
import PairCard from './components/PairCard'
import Room from './components/Room'
import FailureCard from './components/FailureCard'
import Honesty from './components/Honesty'
import { initFromUrl, useBeamStore } from './stores/beamStore'

const REPO_URL = 'https://github.com/universal-simulation-ltd/Universal_Beam'

export default function App() {
  const phase = useBeamStore((s) => s.phase)

  // Mint a code (or pick one up from ?c=) and open the rendezvous room on first
  // paint, so the QR on screen is live before anyone presses anything.
  // initFromUrl() is idempotent — StrictMode's double-invoke would otherwise
  // open two sockets on the same code and the room caps at two peers, which
  // would lock the actual peer out with a 409.
  useEffect(() => {
    initFromUrl()
  }, [])

  const inRoom = phase === 'connected' || phase === 'ended'

  return (
    <div className="flex min-h-screen flex-col bg-slate-100 dark:bg-slate-950">
      <UniversalAppsNavBar
        product="beam"
        productLogo={<ProductLogo />}
        productHomeHref={import.meta.env.BASE_URL}
        actions={<AppMenu />}
        actionsLabel="Beam"
        suiteSwitcherIconSrc={`${import.meta.env.BASE_URL}unisim-icon.png`}
      />

      <UsageTracker />

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 lg:px-8">
        <header className="mb-8">
          <h1 className="text-2xl font-semibold text-slate-900 sm:text-3xl dark:text-slate-100">
            Send text straight between your devices
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600 dark:text-slate-400">
            Pair two browsers with a short code, then type or paste — notes,
            links, anything. It goes device to device, encrypted end to end, and
            no server of ours ever holds a word of it.
          </p>
        </header>

        <div className="space-y-6">
          {/* On failure the explanation goes ABOVE the pairing card, and the
              pairing card stays. Replacing it with the error would leave the
              user reading why it didn't work with no code, no QR and no join
              box to act on — a dead end, when every suggested fix ("same
              Wi-Fi", "try a hotspot") ends in trying again. */}
          {phase === 'failed' && <FailureCard />}
          {inRoom ? <Room /> : <PairCard />}
          <Honesty />
        </div>
      </main>

      <footer className="border-t border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex w-full max-w-5xl flex-row items-center gap-3 px-4 py-4 text-xs text-slate-500 sm:gap-4 sm:px-6 lg:px-8 dark:text-slate-400">
          <span>
            100% free — every feature, no paywalls. We pass a connection code,
            never your text. Hosted by{' '}
            <a
              href="https://www.unisim.co.uk"
              target="_blank"
              rel="noreferrer"
              className="text-slate-700 underline-offset-2 hover:text-orange-600 hover:underline dark:text-slate-300"
            >
              UNI SIM
            </a>
          </span>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            aria-label="Universal Beam on GitHub"
            title="View source on GitHub"
            className="ml-auto inline-flex shrink-0 items-center gap-1.5 text-slate-600 transition-colors hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5" aria-hidden="true">
              <path d="M12 .5C5.65.5.5 5.65.5 12.02c0 5.09 3.29 9.4 7.86 10.92.57.1.78-.25.78-.55 0-.27-.01-1-.02-1.96-3.2.69-3.87-1.54-3.87-1.54-.52-1.33-1.28-1.69-1.28-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.03 1.76 2.7 1.25 3.36.95.1-.74.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.28 1.18-3.08-.12-.29-.51-1.46.11-3.05 0 0 .97-.31 3.18 1.18.92-.26 1.91-.39 2.89-.39.98 0 1.97.13 2.89.39 2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.8 1.18 1.82 1.18 3.08 0 4.42-2.69 5.39-5.26 5.68.41.35.77 1.05.77 2.12 0 1.53-.01 2.76-.01 3.14 0 .3.21.66.79.55 4.57-1.52 7.86-5.83 7.86-10.92C23.5 5.65 18.35.5 12 .5z" />
            </svg>
            <span className="hidden sm:inline">GitHub</span>
          </a>
        </div>
      </footer>
    </div>
  )
}
