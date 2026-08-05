// Clipboard, and the honest limits of it in a browser tab.
//
// ⚠️ This app must never promise clipboard MIRRORING. `readText()` does not
// exist in Firefox at all, and where it does exist it is permission-gated and
// requires a user gesture — there is no background read, by design. So "paste
// from clipboard" is a BUTTON the user presses, and if it is unavailable the UI
// says "press Ctrl/Cmd-V in the box" rather than silently doing nothing.
// Real clipboard sync needs a resident native agent; that is a different
// product (Universal Screens' territory), not something to imply here.

/** Is a one-tap paste button worth rendering at all in this browser? */
export function canReadClipboard(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.clipboard?.readText === 'function'
}

/** Read the clipboard, or return null if the browser/user said no.
 *  Must be called synchronously from a user gesture handler. */
export async function readClipboard(): Promise<string | null> {
  if (!canReadClipboard()) return null
  try {
    return await navigator.clipboard.readText()
  } catch {
    // Denied permission, or no gesture. Not an error worth a dialog.
    return null
  }
}

/** Copy text out. Falls back to the legacy execCommand path for browsers (and
 *  insecure origins) where the async clipboard API is missing. */
export async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // fall through to the legacy path
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

/** Does this message look like a single link we can offer to open?
 *  Deliberately strict — one token, http(s) only, no javascript: smuggling. */
export function asSingleLink(body: string): string | null {
  const trimmed = body.trim()
  if (/\s/.test(trimmed)) return null
  try {
    const url = new URL(trimmed)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}
