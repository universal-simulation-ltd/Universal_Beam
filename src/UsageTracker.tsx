import { useEffect, useRef } from 'react'
import { useUniversal, useUsageTracker, track } from '@unisim/sdk'

/**
 * Emits a single `session.opened` usage_events row when a signed-in user with an
 * active org opens the app, so god-mode's "last product used" column (universal-
 * platform migration 0052) populates. No-op while anonymous — the SDK drops
 * usage events without a session/org. Mount once inside <UniversalProvider>.
 *
 * ⚠️ This is the component that breaks if `beam` is missing from the Postgres
 * `product_code` enum — and it breaks invisibly, for signed-in users only. See
 * the long note in main.tsx. Nothing here needs changing when the migration
 * lands; it just starts working.
 *
 * Note what is NOT tracked: no event carries a code, a message, a length or a
 * peer. This app's whole claim is that we never see the payload, and a
 * well-meaning `track('beam.sent', { chars })` would start quietly building the
 * usage graph that claim promises does not exist.
 */
export default function UsageTracker() {
  useUsageTracker()
  const { session, activeOrgId } = useUniversal()
  const fired = useRef(false)
  useEffect(() => {
    if (fired.current || !session || !activeOrgId) return
    fired.current = true
    track('session.opened')
  }, [session, activeOrgId])
  return null
}
