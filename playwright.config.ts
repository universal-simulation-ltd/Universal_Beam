import { defineConfig, devices } from '@playwright/test'

const PORT = 5197
const BASE_URL = `http://localhost:${PORT}`

// These specs pair two REAL browser contexts through the REAL rendezvous
// (opensource.unisim.co.uk/rtc/room) and push text over a REAL RTCDataChannel.
// Nothing here is mocked, which is the point: a pairing app that only compiles
// proves nothing at all. It therefore needs an internet connection to run —
// see the note in scripts/preview.sh about why that is true even locally.
export default defineConfig({
  testDir: './e2e',
  // `.e2e.ts`, not `.spec.ts`, on purpose: Vitest's default include pattern is
  // `**/*.{test,spec}.*`, so a spec-named file here would be collected by
  // `npm test` and fail to even import. The extension is the boundary between
  // the two runners.
  testMatch: /.*\.e2e\.ts$/,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: [
            // Without this, Chrome replaces host candidates with unresolvable
            // `<uuid>.local` mDNS names to hide the machine's private IP. That
            // is right for the web and wrong for a headless box with no mDNS
            // responder, where it turns the fastest path (loopback/LAN) into a
            // dead one and leaves the test relying on STUN.
            '--disable-features=WebRtcHideLocalIpsWithMdns',
          ],
        },
      },
    },
  ],
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
