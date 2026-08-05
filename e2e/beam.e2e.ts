import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'

// Two browser contexts, the live rendezvous, a real RTCDataChannel, real text.
//
// This file exists because everything else in the repo can be green while the
// product does not work. Types check, the bundle builds, the unit tests cover
// pure functions — and none of that says a character ever left one browser and
// arrived in another. Only this does.

declare global {
  interface Window {
    /** Installed by the socket test below, not by the app. */
    __rtcWs?: { opened: number; closed: number }
  }
}

/** Open a fresh, isolated context (its own storage, its own everything) and
 *  return the page. Two contexts rather than two tabs, so nothing is shared
 *  that would not be shared between two devices. */
async function openApp(browser: Browser, path = '/'): Promise<Page> {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(path)
  return page
}

function status(page: Page) {
  return page.getByTestId('status-pill')
}

async function hostCode(page: Page): Promise<string> {
  const code = (await page.getByTestId('pair-code').innerText()).trim()
  expect(code).toMatch(/^[A-Z0-9]{6}$/)
  return code
}

test.describe('pairing and beaming text', () => {
  test('two browsers pair by code and send text both ways, peer to peer', async ({ browser }) => {
    const a = await openApp(browser)

    // The host mints a code and opens the room on first paint — no button.
    const code = await hostCode(a)
    await expect(status(a)).toHaveAttribute('data-phase', 'waiting')

    // The second device arrives on the deep link a QR scan would produce.
    const b = await openApp(browser, `/?c=${code}`)

    await expect(status(a)).toHaveAttribute('data-phase', 'connected', { timeout: 45_000 })
    await expect(status(b)).toHaveAttribute('data-phase', 'connected', { timeout: 45_000 })

    // With no TURN configured anywhere, a relayed route is not merely
    // undesirable — it should be impossible. If this ever fires, someone has
    // put a relay in the path and the "straight between your devices" claim
    // needs re-checking, not the test.
    const route = (await status(a).innerText()).trim()
    test.info().annotations.push({ type: 'route', description: route })
    expect(route).not.toMatch(/relay/i)
    expect(route).toMatch(/direct/i)

    // ── A → B ────────────────────────────────────────────────────────────────
    const outbound = `hello from A ${Date.now()}`
    await a.getByTestId('composer').fill(outbound)
    await a.getByTestId('send').click()

    await expect(b.getByTestId('message-in')).toContainText(outbound, { timeout: 15_000 })
    await expect(a.getByTestId('message-out')).toContainText(outbound)

    // ── B → A ────────────────────────────────────────────────────────────────
    // The roles are symmetric once the channel is up; prove it rather than
    // assuming it, because only one side ever created the data channel.
    const inbound = `reply from B ${Date.now()}`
    await b.getByTestId('composer').fill(inbound)
    await b.getByTestId('send').click()

    await expect(a.getByTestId('message-in')).toContainText(inbound, { timeout: 15_000 })

    // A multi-line paste is the actual use case (a note, a snippet), and it is
    // what a naive newline-delimited wire format would silently corrupt.
    const multiline = 'line one\nline two\n\nline four with  spaces'
    await a.getByTestId('composer').fill(multiline)
    await a.getByTestId('send').click()
    await expect(b.getByTestId('message-in').last()).toContainText('line four with  spaces', {
      timeout: 15_000,
    })

    // A link arrives intact and is offered as a link, not merely as text.
    await a.getByTestId('composer').fill('https://opensource.unisim.co.uk/beam/')
    await a.getByTestId('send').click()
    await expect(b.getByRole('link', { name: 'Open link' })).toBeVisible({ timeout: 15_000 })

    await a.context().close()
    await b.context().close()
  })

  test('the rendezvous socket really is closed once the channel is up', async ({ browser }) => {
    // The product claim is "no server ever holds your text". The strongest form
    // of that is not trusting the relay to stay out of the payload path but
    // physically removing it — so assert the socket is gone, and that text
    // still moves afterwards.
    const context = await browser.newContext()
    await context.addInitScript(() => {
      const counter = { opened: 0, closed: 0 }
      window.__rtcWs = counter
      const Native = window.WebSocket
      class Counting extends Native {
        constructor(url: string | URL, protocols?: string | string[]) {
          super(url, protocols)
          // Vite's HMR socket lives on this page too and never closes; count
          // only the rendezvous.
          if (String(url).includes('/rtc/room')) {
            counter.opened += 1
            this.addEventListener('close', () => { counter.closed += 1 })
          }
        }
      }
      window.WebSocket = Counting as unknown as typeof WebSocket
    })

    const a = await context.newPage()
    await a.goto('/')
    const code = await hostCode(a)

    const b = await context.newPage()
    await b.goto(`/?c=${code}`)

    await expect(status(a)).toHaveAttribute('data-phase', 'connected', { timeout: 45_000 })

    const openSockets = () =>
      a.evaluate(() => {
        const c = window.__rtcWs
        return c ? c.opened - c.closed : -1
      })

    expect(await openSockets()).toBeGreaterThan(0)

    // SIGNALLING_LINGER_MS is 4s after the channel opens.
    await expect.poll(openSockets, { timeout: 20_000, message: 'rendezvous socket never closed' })
      .toBe(0)

    const afterHangup = `sent with the room closed ${Date.now()}`
    await a.getByTestId('composer').fill(afterHangup)
    await a.getByTestId('send').click()
    await expect(b.getByTestId('message-in')).toContainText(afterHangup, { timeout: 15_000 })

    await context.close()
  })
})

test.describe('direct-or-fail', () => {
  test('says why, in words, instead of spinning forever', async ({ browser }) => {
    // The slowest test here by construction: it can only pass by waiting out
    // the 20s connect watchdog, on top of two page loads and a real pairing
    // round-trip. On a cold Vite dev server (first run, deps still being
    // optimised) that has been observed to overrun a 60s budget — so give it
    // room rather than letting a slow machine read as a product failure.
    test.setTimeout(180_000)

    // Beam ships with no paid TURN, so on a symmetric-NAT or locked-down
    // network two devices genuinely cannot connect. Reproduce that honestly:
    // force ICE to relay-only through a TURN server that does not exist, so
    // neither browser gathers a usable candidate and the negotiation really
    // does fail. Nothing about the app is stubbed — only the network.
    const context: BrowserContext = await browser.newContext()
    await context.addInitScript(() => {
      const Native = window.RTCPeerConnection
      class Doomed extends Native {
        constructor(config?: RTCConfiguration) {
          super({
            ...config,
            iceServers: [{ urls: 'turn:127.0.0.1:19302', username: 'x', credential: 'x' }],
            iceTransportPolicy: 'relay',
          })
        }
      }
      window.RTCPeerConnection = Doomed as unknown as typeof RTCPeerConnection
    })

    const a = await context.newPage()
    await a.goto('/')
    const code = await hostCode(a)

    const b = await context.newPage()
    await b.goto(`/?c=${code}`)

    // The watchdog is 20s. Well inside a minute, the app must have stopped
    // pretending and started explaining.
    const failure = a.getByTestId('failure')
    await expect(failure).toBeVisible({ timeout: 120_000 })

    // A headline, an explanation and something to try — not a bare error code,
    // and above all not a spinner.
    await expect(failure.getByRole('heading')).not.toBeEmpty()
    await expect(failure).toContainText('Worth trying')
    await expect(failure).toContainText(/Wi-Fi/i)
    await expect(status(a)).toHaveAttribute('data-phase', 'failed')

    // The evidence is there for a bug report, behind a toggle — and it reports
    // the thing this build's honesty depends on: no TURN was on offer.
    await a.getByRole('button', { name: 'Technical details' }).click()
    await expect(failure).toContainText('turn offered=false')

    await context.close()
  })
})

test.describe('house rules', () => {
  test('opens in light mode and stays there until asked otherwise', async ({ browser }) => {
    // Standing suite rule: an app opens LIGHT and only goes dark when the user
    // says so. Deliberately stronger than "respect the OS" — a laptop that
    // schedules dark at sunset must not flip an app the user never configured.
    const context = await browser.newContext({ colorScheme: 'dark' })
    const page = await context.newPage()
    await page.goto('/')
    await expect(page.locator('html')).not.toHaveClass(/(^|\s)dark(\s|$)/)
    await expect(page.locator('html')).toHaveAttribute('style', /color-scheme:\s*light/)
    await context.close()
  })

  test('never promises what the browser cannot do', async ({ browser }) => {
    // The three sentences that must never appear on the page, because each is
    // false on a leg this product actually supports (next-products.md §13.3).
    const page = await openApp(browser)
    const body = await page.locator('body').innerText()
    expect(body).not.toMatch(/never leaves your network/i)
    expect(body).not.toMatch(/no servers? (are )?involved/i)
    expect(body).not.toMatch(/works offline|no internet needed/i)
    // And the limitation that must be present rather than buried.
    expect(body).toMatch(/need the internet/i)
    await page.context().close()
  })
})
