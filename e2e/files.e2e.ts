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

async function openApp(browser: Browser, path = '/', muteHandshake = false): Promise<Page> {
  const context = await browser.newContext()
  await context.addInitScript(() => {
    // Force the Firefox/Safari path: accumulate in memory, then download.
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true })
  })
  if (muteHandshake) {
    // Impersonate a pre-files build. v1 has no `peer` frame to send, so what
    // the other end actually observes is silence — swallowing the frame on the
    // way out reproduces that exactly, without needing to serve the old bundle.
    await context.addInitScript(() => {
      const send = RTCDataChannel.prototype.send
      RTCDataChannel.prototype.send = function (this: RTCDataChannel, data: string) {
        if (typeof data === 'string' && data.includes('"t":"peer"')) return
        return send.call(this, data as string)
      } as typeof send
    })
  }
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

  // The version handshake cuts both ways, and THIS is the direction that can
  // regress silently: if the `peer` frame is ever dropped, renamed or delayed
  // past PEER_HELLO_MS, two perfectly current browsers start accusing each
  // other of being out of date and disable file sending on a session that
  // would have worked. A false positive here is worse than the bug it guards.
  test('two current builds never accuse each other of being old, and either end can send', async ({ browser }) => {
    test.setTimeout(120_000)
    const [a, b] = await pairTwo(browser)

    // Past PEER_HELLO_MS (3 s) with room to spare — the whole point is that the
    // deadline has been and gone without a verdict of "legacy".
    await a.waitForTimeout(5_000)

    for (const page of [a, b]) {
      await expect(page.getByTestId('legacy-peer')).toHaveCount(0)
      await expect(page.getByTestId('send-file')).toBeEnabled()
    }

    // And the reverse direction actually carries bytes. Every other spec in
    // this file sends host → guest; guest → host had no coverage at all.
    const payload = randomBytes(512 * 1024)
    await b.getByTestId('file-input').setInputFiles({
      name: 'from-the-guest.bin',
      mimeType: 'application/octet-stream',
      buffer: payload,
    })

    await expect(a.getByTestId('transfer-in')).toBeVisible({ timeout: 15_000 })
    const downloadPromise = a.waitForEvent('download', { timeout: 60_000 })
    await a.getByTestId('accept-file').click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toBe('from-the-guest.bin')
    expect(sha256(readFileSync(await download.path()))).toBe(sha256(payload))

    await expect(b.getByTestId('transfer-out')).toHaveAttribute('data-status', 'done', { timeout: 15_000 })

    await a.context().close()
    await b.context().close()
  })

  // The bug this whole handshake exists for: a peer running the text-only build
  // swallows a file offer without a word, so the sender waits on an accept that
  // can never come. Being told beforehand is the entire fix.
  test('a peer that cannot speak the handshake is named as old, and file sending is closed off', async ({ browser }) => {
    test.setTimeout(120_000)
    const a = await openApp(browser)
    const code = (await a.getByTestId('pair-code').innerText()).trim()
    const b = await openApp(browser, `/?c=${code}`, true)
    await expect(status(a)).toHaveAttribute('data-phase', 'connected', { timeout: 45_000 })
    await expect(status(b)).toHaveAttribute('data-phase', 'connected', { timeout: 45_000 })

    // The verdict lands on its own, from silence — nothing to click.
    await expect(a.getByTestId('legacy-peer')).toBeVisible({ timeout: 15_000 })
    await expect(a.getByTestId('legacy-peer')).toContainText('older version')
    await expect(a.getByTestId('send-file')).toBeDisabled()

    // Text is unaffected: the older build understands it perfectly, and
    // degrading the half that still works would be its own bug.
    const note = `text still crosses ${Date.now()}`
    await a.getByTestId('composer').fill(note)
    await a.getByTestId('send').click()
    await expect(b.getByTestId('message-in')).toContainText(note, { timeout: 15_000 })

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
