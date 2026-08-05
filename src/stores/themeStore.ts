import { create } from 'zustand'

// Light mode is the default across the whole suite — the app opens light and
// STAYS light until the user explicitly asks for something else. That is a
// standing rule, and it is deliberately stronger than "respect the OS": an app
// that flips to dark because the user's laptop schedules dark at sunset looks
// broken to someone who never asked for it. `system` is available; it is just
// not the default.
export type ThemePref = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'unisim-beam-theme'

function readStored(): ThemePref {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch { /* private mode / storage disabled */ }
  return 'light'
}

function resolve(pref: ThemePref): 'light' | 'dark' {
  if (pref !== 'system') return pref
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function apply(pref: ThemePref): 'light' | 'dark' {
  const effective = resolve(pref)
  document.documentElement.classList.toggle('dark', effective === 'dark')
  document.documentElement.style.colorScheme = effective
  return effective
}

interface ThemeState {
  pref: ThemePref
  effective: 'light' | 'dark'
  setPref(pref: ThemePref): void
}

export const useThemeStore = create<ThemeState>((set) => {
  const pref = readStored()
  const effective = apply(pref)

  // Only track the OS while the user has actually opted into `system`.
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener('change', () => {
    const current = useThemeStore.getState().pref
    if (current === 'system') set({ effective: apply('system') })
  })

  return {
    pref,
    effective,
    setPref(next) {
      try { localStorage.setItem(STORAGE_KEY, next) } catch { /* ignore */ }
      set({ pref: next, effective: apply(next) })
    },
  }
})
