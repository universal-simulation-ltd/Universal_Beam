import { expect, test, type Page } from '@playwright/test'
import { PNG } from 'pngjs'
import { BinaryBitmap, HybridBinarizer, QRCodeReader, RGBLuminanceSource } from '@zxing/library'

// The pairing QR is UNI·SIM branded — rounded warm-black modules, orange
// finder eyes, the mark in the centre — and branding is exactly how a QR stops
// scanning. Universal QR's first branded default was unscannable by its own
// scan tab, and nothing about it looked wrong. So this spec does not trust the
// arrangement (even though it mirrors the one Universal QR measured): it
// screenshots the pixels Beam actually renders, at the size it actually
// renders them, and decodes them with zxing — a strict reader that rejects
// inverted and low-contrast codes rather than guessing. If a restyle ever
// breaks the scan, this fails before a user's phone camera does.

/** Decode the (only) QR in a PNG screenshot, or throw. */
function decodeQr(png: Buffer): string {
  const { width, height, data } = PNG.sync.read(png)
  const luminances = new Uint8ClampedArray(width * height)
  for (let i = 0; i < width * height; i++) {
    // ITU-R BT.601 weights — the same conversion zxing's own sources use.
    luminances[i] = data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114
  }
  const bitmap = new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(luminances, width, height)))
  return new QRCodeReader().decode(bitmap).getText()
}

async function qrScreenshot(page: Page, testId = 'pair-qr'): Promise<Buffer> {
  const qr = page.getByTestId(testId)
  await expect(qr.locator('svg')).toBeVisible()
  // Screenshot the padded white card AROUND the code, not the code itself —
  // that padding is the quiet zone, and a decoder is entitled to it.
  return await qr.locator('..').screenshot()
}

/** The QR redraws asynchronously (it waits on the centre image), so poll the
 *  decode instead of racing it. An undecodable frame reads as '' and the poll
 *  keeps trying; only a persistent failure or a wrong payload fails the test. */
async function expectQrToDecodeTo(page: Page, expected: string, testId = 'pair-qr'): Promise<void> {
  await expect
    .poll(
      async () => {
        try {
          return decodeQr(await qrScreenshot(page, testId))
        } catch {
          return ''
        }
      },
      { timeout: 15_000 },
    )
    .toBe(expected)
}

test.describe('the pairing QR', () => {
  test('is branded AND still decodes, strictly, to the join link', async ({ page }) => {
    await page.goto('/')
    const code = (await page.getByTestId('pair-code').innerText()).trim()
    expect(code).toMatch(/^[A-Z0-9]{6}$/)

    await expectQrToDecodeTo(page, `${new URL(page.url()).origin}/?c=${code}`)
  })

  test('still decodes after a new code replaces the old one', async ({ page }) => {
    // The component UPDATES an existing rendering rather than remounting; make
    // sure the second render is as scannable as the first and carries the new
    // code, not the stale one.
    await page.goto('/')
    const first = (await page.getByTestId('pair-code').innerText()).trim()

    await page.getByTestId('new-code').click()
    await expect(page.getByTestId('pair-code')).not.toHaveText(first)
    const second = (await page.getByTestId('pair-code').innerText()).trim()

    await expectQrToDecodeTo(page, `${new URL(page.url()).origin}/?c=${second}`)
  })

  test('enlarges over a dimmed page, and the big one scans too', async ({ page }) => {
    // The enlarged code is REGENERATED at the bigger size rather than scaled up
    // with CSS, so it is a second rendering and has to be decoded as one. A
    // blurred upscale would still look fine in a screenshot and fail a camera.
    await page.goto('/')
    const code = (await page.getByTestId('pair-code').innerText()).trim()

    const small = await page.getByTestId('pair-qr').boundingBox()
    await page.getByTestId('enlarge-qr').click()

    const modal = page.getByTestId('qr-enlarged')
    await expect(modal).toBeVisible()
    const big = await page.getByTestId('pair-qr-enlarged').boundingBox()
    expect(big!.width).toBeGreaterThan(small!.width * 2)

    await expectQrToDecodeTo(page, `${new URL(page.url()).origin}/?c=${code}`, 'pair-qr-enlarged')

    // A phone held against the screen must not dismiss it; the backdrop must.
    await page.getByTestId('pair-qr-enlarged').click({ position: { x: 8, y: 8 } })
    await expect(modal).toBeVisible()
    await page.mouse.click(20, 400)
    await expect(modal).toBeHidden()

    // Escape, and the keyboard path in — the picture is aria-hidden, so the
    // button is the only thing assistive tech or a keyboard can reach.
    await page.getByTestId('enlarge-qr').focus()
    await page.keyboard.press('Enter')
    await expect(modal).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(modal).toBeHidden()
  })
})
