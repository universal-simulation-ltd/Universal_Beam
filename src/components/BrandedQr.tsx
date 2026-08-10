import { useEffect, useRef } from 'react'
import QRCodeStyling from 'qr-code-styling'

// The UNI·SIM branded QR — the same arrangement Universal QR ships as its
// default (Universal_QR/src/lib/qr.ts, DEFAULT_CONFIG), so a code on a Beam
// screen and a code out of the QR studio read as one product family.
//
// The arrangement is load-bearing, not decoration, and it was MEASURED there:
// warm off-black modules (#1c1917) on white for contrast a decoder can rely
// on, the three finder eyes in orange-600 (#e05504 — the deeper of the brand
// pair; the lighter #fe8c01 sits below the 3:1 floor and failed to decode at
// 512 px), error correction pinned at 'H' so the centre mark can obscure
// modules without costing the scan. Don't restyle any of it without re-running
// a decode check — the e2e in e2e/beam.e2e.ts does exactly that with zxing,
// the strict reader that rejected the QR app's first branded attempt.
//
// The centre image is the same unisim-icon.png the navbar already loads, so it
// is cached before this ever renders; no inlined data URI needed here.

const SIZE = 160

function makeQr(data: string): QRCodeStyling {
  return new QRCodeStyling({
    type: 'svg',
    width: SIZE,
    height: SIZE,
    // No quiet zone here — the white padded card around the component provides
    // it, exactly as it did for the plain code this replaces.
    margin: 0,
    data,
    image: `${import.meta.env.BASE_URL}unisim-icon.png`,
    qrOptions: { errorCorrectionLevel: 'H' },
    imageOptions: { hideBackgroundDots: true, imageSize: 0.28, margin: 2, crossOrigin: 'anonymous' },
    dotsOptions: { type: 'rounded', color: '#1c1917' },
    cornersSquareOptions: { type: 'extra-rounded', color: '#e05504' },
    cornersDotOptions: { type: 'dot', color: '#e05504' },
    backgroundOptions: { color: '#ffffff' },
  })
}

/** Renders `value` as a UNI·SIM branded QR. The adjacent six-character code is
 *  the accessible path to the same pairing, so the picture itself is hidden
 *  from assistive tech. */
export default function BrandedQr({ value }: { value: string }) {
  const host = useRef<HTMLDivElement>(null)
  const qr = useRef<QRCodeStyling | null>(null)

  useEffect(() => {
    if (!host.current) return
    if (!qr.current) {
      qr.current = makeQr(value)
      qr.current.append(host.current)
    } else {
      qr.current.update({ data: value })
    }
  }, [value])

  return (
    <div
      ref={host}
      data-testid="pair-qr"
      aria-hidden="true"
      style={{ width: SIZE, height: SIZE }}
    />
  )
}
