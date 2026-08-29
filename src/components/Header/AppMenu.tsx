import { AdvancedMenu } from '@unisim/sdk'
import { useBeamStore } from '../../stores/beamStore'
import { useThemeStore, type ThemePref } from '../../stores/themeStore'

// The per-app rows that slot into <UniversalAppsNavBar />'s `actions` prop —
// ROWS ONLY, no trigger and no panel of its own. The SDK renders them inside
// the merged profile pill, so the bar carries one dropdown on the right rather
// than an app menu on the left and an avatar on the right.
//
// Styling is inline rather than Tailwind to match the SDK dropdown's own rows
// (the same 8px/14px rhythm and 13px label the profile and language rows use) —
// these render inside SDK chrome, not ours.

const TINT = { bg: '#fff7ed', fg: '#c2410c' }
const REST_COLOR = '#374151'

const THEMES: { pref: ThemePref; label: string; glyph: string }[] = [
  { pref: 'light', label: 'Light', glyph: '☀️' },
  { pref: 'dark', label: 'Dark', glyph: '🌙' },
  // 'system' is offered but is deliberately NOT the default — see themeStore.
  { pref: 'system', label: 'Match my device', glyph: '🖥️' },
]

export default function AppMenu() {
  const newCode = useBeamStore((s) => s.newCode)
  const clearMessages = useBeamStore((s) => s.clearMessages)
  const messageCount = useBeamStore((s) => s.messages.length)
  const pref = useThemeStore((s) => s.pref)
  const setPref = useThemeStore((s) => s.setPref)

  return (
    <>
      <MenuLabel>Session</MenuLabel>
      <MenuRow glyph="🔄" label="Start a new code" onClick={newCode} />
      <MenuRow
        glyph="🧹"
        label={messageCount ? `Clear this session (${messageCount})` : 'Clear this session'}
        onClick={clearMessages}
        disabled={messageCount === 0}
      />
      <MenuLabel>Appearance</MenuLabel>
      {THEMES.map((t) => (
        <MenuRow
          key={t.pref}
          glyph={t.glyph}
          label={t.label}
          selected={pref === t.pref}
          onClick={() => setPref(t.pref)}
        />
      ))}

      {/* Advanced — the SDK's own category, so every app in the suite has one in
          the same place, and whatever goes in it next is one change rather than
          nineteen. "About this app" is always its last row. */}
      <AdvancedMenu
        about={{
          repo:    'https://github.com/universal-simulation-ltd/Universal_Beam',
          subject: 'Your files',
          plural:  true,
          except:  'beaming them to a device you paired with',
          headline: 'Other transfer services keep a copy of your file on their servers.',
          version: __APP_VERSION__,
        }}
      />
    </>
  )
}

function MenuLabel({ children }: { children: string }) {
  return (
    <div
      style={{
        padding: '8px 14px 4px',
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        color: '#9ca3af',
      }}
    >
      {children}
    </div>
  )
}

function MenuRow({
  glyph,
  label,
  onClick,
  selected = false,
  disabled = false,
}: {
  glyph: string
  label: string
  onClick: () => void
  selected?: boolean
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        width: '100%',
        padding: '8px 14px',
        fontSize: 13,
        fontFamily: 'inherit',
        textAlign: 'left',
        border: 0,
        background: selected ? TINT.bg : 'transparent',
        color: disabled ? '#9ca3af' : selected ? TINT.fg : REST_COLOR,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        transition: 'background 120ms, color 120ms',
      }}
      onMouseEnter={(e) => {
        if (disabled) return
        e.currentTarget.style.background = TINT.bg
        e.currentTarget.style.color = TINT.fg
      }}
      onMouseLeave={(e) => {
        if (disabled) return
        e.currentTarget.style.background = selected ? TINT.bg : 'transparent'
        e.currentTarget.style.color = selected ? TINT.fg : REST_COLOR
      }}
    >
      <span aria-hidden>{glyph}</span>
      <span style={{ flex: 1, minWidth: 0, fontWeight: 500, lineHeight: 1.3 }}>{label}</span>
      {selected && <span aria-hidden style={{ color: TINT.fg }}>✓</span>}
    </button>
  )
}
