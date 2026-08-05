import React from 'react'
import ReactDOM from 'react-dom/client'
import { UniversalProvider } from '@unisim/sdk'
import App from './App'
import './index.css'

// Universal Beam moves text peer-to-peer and writes nothing to Supabase. We
// still mount <UniversalProvider> so the shared navbar works and, when the
// visitor is signed in on .unisim.co.uk, the navbar shows their profile/avatar.
//
// The fallback is the REAL public suite project (publishable anon key — safe to
// ship; RLS is the security boundary). Env overrides.
//
// ⚠️ 'beam' AND THE product_code ENUM — read before shipping.
//
// `useUsageTracker()` inserts into usage_events with `product: config.product`,
// and product_code is a Postgres ENUM. A value that isn't in the enum makes
// every insert FAIL — silently, and only for SIGNED-IN visitors, so the app
// looks perfect in the state most people use it in. That is not hypothetical:
// Universal Converter and Universal USB both shipped that way and lost every
// usage event from launch until migration 0107 caught it. There is no backfill.
//
// STATUS 2026-08-05 — both halves are now DONE, which is why there is no cast
// on the `product` line below:
//
//   1. `alter type product_code add value if not exists 'beam';` landed in
//      backoffice/universal-platform as its own migration and is applied to
//      prod. (It had to be its own migration — Postgres will not let a newly
//      added enum value be USED in the transaction that adds it.)
//   2. 'beam' is in `ProductCode` (packages/sdk/src/types.ts), in
//      `SuiteProductId` (packages/sdk/src/SuiteSwitcher.tsx) and in
//      `UNIVERSAL_APP_PRODUCTS` (packages/sdk/src/provider.tsx, so language
//      preference is scoped to the open-source apps rather than carrying over
//      into the Assess suite). Shipped in @unisim/sdk 0.85.0.
//
// So `product: 'beam'` below type-checks *because the union really contains it*
// — not because a cast talked the compiler out of an objection. Never write
// `as unknown as ProductCode` in this repo: that cast is exactly what let the
// Converter/USB bug survive to production. If the type ever fights you here,
// the type is telling you the enum is missing a value — go add it.
//
// One thing 'beam' is still missing: an entry in the SDK's
// DEFAULT_UNIVERSAL_APPS_PRODUCTS catalogue, which is where the navbar reads
// the product's display name from. Until the SDK ships one, App.tsx passes a
// local catalogue (see lib/catalogue.tsx).

const universalConfig = {
  supabaseUrl: import.meta.env.VITE_PLATFORM_SUPABASE_URL || 'https://rygfxgalojojppxmhddo.supabase.co',
  supabaseAnonKey: import.meta.env.VITE_PLATFORM_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ5Z2Z4Z2Fsb2pvanBweG1oZGRvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3NTY4MjUsImV4cCI6MjA5NDMzMjgyNX0.hLy_vt9vY_rdPKF3nL32yAuMCD604E3CH5VM7D7CaNE',
  product: 'beam' as const,
  cookieDomain: import.meta.env.PROD ? '.unisim.co.uk' : undefined,
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <UniversalProvider config={universalConfig}>
      <App />
    </UniversalProvider>
  </React.StrictMode>
)
