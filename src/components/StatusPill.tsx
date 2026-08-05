import { useBeamStore } from '../stores/beamStore'

// One line that always tells the truth about where the session is. It is the
// thing a user glances at when they are wondering whether to keep waiting, so
// it never says "connecting" for a state that is actually stuck — that is what
// the failure card is for.

const TONE = {
  idle: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  waiting: 'bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
  pairing: 'bg-sky-50 text-sky-800 dark:bg-sky-950 dark:text-sky-200',
  connected: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  failed: 'bg-rose-50 text-rose-800 dark:bg-rose-950 dark:text-rose-200',
  ended: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
} as const

export default function StatusPill() {
  const phase = useBeamStore((s) => s.phase)
  const route = useBeamStore((s) => s.route)

  const label =
    phase === 'connected'
      ? (route?.label ?? 'Connected')
      : phase === 'waiting'
        ? 'Waiting for the other device'
        : phase === 'pairing'
          ? 'Connecting the two devices…'
          : phase === 'failed'
            ? 'Not connected'
            : phase === 'ended'
              ? 'Session ended'
              : 'Starting…'

  return (
    <span
      data-testid="status-pill"
      data-phase={phase}
      className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${TONE[phase]}`}
    >
      <span
        aria-hidden
        className={`w-1.5 h-1.5 rounded-full bg-current ${phase === 'waiting' || phase === 'pairing' ? 'beam-pulse' : ''}`}
      />
      {label}
    </span>
  )
}
