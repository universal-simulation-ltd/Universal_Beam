import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import pkg from './package.json' with { type: 'json' }

// Universal Beam is served at opensource.unisim.co.uk/beam in production.
// `base` + PWA scope derive from Vite's `mode`; local dev stays `/`.
//
// ⚠️ The one thing this app cannot do offline is PAIR. The service worker makes
// the shell load without a network, but the rendezvous (a Cloudflare Durable
// Object) is how two browsers find each other — a browser tab cannot discover
// anything on the LAN. So "installable / offline shell" is true and "works with
// no internet" is FALSE. Don't let the PWA manifest imply otherwise; the UI
// says so in plain words (see components/Honesty.tsx).
export default defineConfig(({ mode }) => {
  const BASE_PATH = mode === 'production' ? '/beam/' : '/'
  return {
    base: BASE_PATH,
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version)
    },
    resolve: {
      // Force a single React instance so @unisim/sdk's hooks share the same
      // dispatcher as the host app (see Universal QR for the rationale).
      dedupe: ['react', 'react-dom']
    },
    optimizeDeps: {
      exclude: ['@unisim/sdk'],
      // ⚠️ REQUIRED, and only in dev. The SDK's <UnisimQr> reaches
      // qr-code-styling through a dynamic import, and that package ships UMD
      // only — no ESM build. Because @unisim/sdk is excluded above, Vite serves
      // that dependency raw instead of pre-bundling it, and a UMD wrapper
      // evaluated as an ES module dies on "Cannot set properties of undefined
      // (setting 'QRCodeStyling')" — which the component catches, so all you
      // see is "This code couldn't be drawn". Naming it here forces the CJS
      // interop. `vite build` is unaffected; this bites in dev only.
      include: ['qr-code-styling']
    },
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.svg', 'unisim-icon.png', 'icon-180.png', 'icon-192.png', 'icon-512.png'],
        manifest: {
          name: 'Universal Beam',
          short_name: 'UniBeam',
          description: 'Send text and files straight between your devices — peer-to-peer, never stored on a server',
          theme_color: '#0f172a',
          background_color: '#f8fafc',
          display: 'standalone',
          start_url: BASE_PATH,
          scope: BASE_PATH,
          icons: [
            { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
            { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
            { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
            { src: 'unisim-icon.png', sizes: '128x128', type: 'image/png', purpose: 'any' }
          ]
        },
        workbox: {
          navigateFallback: `${BASE_PATH}index.html`,
        },
        devOptions: { enabled: false }
      })
    ]
  }
})
