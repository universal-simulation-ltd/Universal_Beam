import { createHash, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { expect, test, type Browser, type Page } from '@playwright/test'

// Files, for real: two isolated browser contexts, the live rendezvous, an
// actual RTCDataChannel, and megabytes of random bytes that must arrive
// IDENTICAL. The unit suite proves the protocol against a fake channel; only
// this proves it against SCTP message limits, real backpressure and a real
// download.
//
// Both contexts run with the File System Access API knocked out, which forces
// the memory-sink path — the one that ends in a download Playwright can
// capture and hash. The disk path (showSaveFilePicker) opens a native dialog
// no test can drive headlessly; its plumbing above the sink is identical, and
// the sink itself is four calls into a browser API. The per-browser split is
// covered by unit tests on supportsStreamingSave().

async function openApp(browser: Browser, path = '/'): Promise<Page> {
  const context = await browser.newContext()
  await context.addInitScript(() => {
    // Force the Firefox/Safari path: accumulate in memory, then download.
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true })
  })
  const page = await context.newPage()
  await page.goto(path)
  return page
}

function status(page: Page) {
  return page.getByTestId('status-pill')
}

async function pairTwo(browser: Browser): Promise<[Page, Page]> {
  const a = await openApp(browser)
  const code = (await a.getByTestId('pair-code').innerText()).trim()
  expect(code).toMatch(/^[A-Z0-9]{6}$/)
  const b = await openApp(browser, `/?c=${code}`)
  await expect(status(a)).toHaveAttribute('data-phase', 'connected', { timeout: 45_000 })
  await expect(status(b)).toHaveAttribute('data-phase', 'connected', { timeout: 45_000 })
  return [a, b]
}

const sha256 = (buf: Buffer) => createHash('sha256').update(buf).digest('hex')

test.describe('beaming a file', () => {
  test('8 MB of random bytes arrive identical, and text still flows afterwards', async ({ browser }) => {
    test.setTimeout(180_000)
    const [a, b] = await pairTwo(browser)

    // Random, not zeros: a transfer that dropped or reordered a chunk of zeros
    // would still hash equal. 8 MB is ~128 chunks — enough to make the
    // backpressure loop actually work on a fast local path.
    const payload = randomBytes(8 * 1024 * 1024)
    await a.getByTestId('file-input').setInputFiles({
      name: 'beam-e2e.bin',
      mimeType: 'application/octet-stream',
      buffer: payload,
    })

    // The offer shows the receiver what they are being handed before a single
    // content byte moves: name and honest size.
    const offer = b.getByTestId('transfer-in')
    await expect(offer).toBeVisible({ timeout: 15_000 })
    await expect(offer).toContainText('beam-e2e.bin')
    await expect(offer).toContainText('8.0 MB')

    // Accept → the bytes cross → the memory sink hands the browser a download.
    const downloadPromise = b.waitForEvent('download', { timeout: 60_000 })
    await b.getByTestId('accept-file').click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toBe('beam-e2e.bin')

    const path = await download.path()
    const received = readFileSync(path)
    expect(received.byteLength).toBe(payload.byteLength)
    expect(sha256(received)).toBe(sha256(payload))

    // Both rows settle to done, in words a person would use.
    await expect(a.getByTestId('transfer-out')).toHaveAttribute('data-status', 'done', { timeout: 15_000 })
    await expect(b.getByTestId('transfer-in')).toHaveAttribute('data-status', 'done')
    await expect(a.getByTestId('transfer-out')).toContainText('Sent')

    // The channel is not left wedged by a big transfer: text still crosses.
    const after = `text after the file ${Date.now()}`
    await a.getByTestId('composer').fill(after)
    await a.getByTestId('send').click()
    await expect(b.getByTestId('message-in')).toContainText(after, { timeout: 15_000 })

    await a.context().close()
    await b.context().close()
  })

  test('declining an offer tells the sender, and the session carries on', async ({ browser }) => {
    test.setTimeout(120_000)
    const [a, b] = await pairTwo(browser)

    await a.getByTestId('file-input').setInputFiles({
      name: 'not-wanted.bin',
      mimeType: 'application/octet-stream',
      buffer: randomBytes(64 * 1024),
    })

    await expect(b.getByTestId('transfer-in')).toBeVisible({ timeout: 15_000 })
    await b.getByTestId('decline-file').click()

    // The sender is told in words, not left waiting on a spinner.
    await expect(a.getByTestId('transfer-out')).toHaveAttribute('data-status', 'declined', { timeout: 15_000 })
    await expect(a.getByTestId('transfer-out')).toContainText('declined')

    // Declining a file must not poison the session.
    const after = `still connected ${Date.now()}`
    await b.getByTestId('composer').fill(after)
    await b.getByTestId('send').click()
    await expect(a.getByTestId('message-in')).toContainText(after, { timeout: 15_000 })

    await a.context().close()
    await b.context().close()
  })

  test('both devices show the same safety number', async ({ browser }) => {
    test.setTimeout(120_000)
    const [a, b] = await pairTwo(browser)

    // The SAS is derived from the two DTLS fingerprints, one per end — so the
    // ONLY way both screens agree is if both browsers negotiated with the same
    // two certificates, i.e. with each other. A rendezvous MITM would run two
    // DTLS sessions and produce two different numbers.
    const sasA = (await a.getByTestId('sas').innerText()).trim()
    const sasB = (await b.getByTestId('sas').innerText()).trim()
    expect(sasA).toMatch(/^\d{3} \d{3}$/)
    expect(sasA).toBe(sasB)

    await a.context().close()
    await b.context().close()
  })
})
