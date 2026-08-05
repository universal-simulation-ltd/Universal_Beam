import { DEFAULT_UNIVERSAL_APPS_PRODUCTS, type SuiteProduct } from '@unisim/sdk'

// The navbar reads the product's DISPLAY NAME from the apps catalogue, not from
// the `productLogo` we hand it — `products.find(p => p.id === product)?.name`.
// `beam` is in the SDK's `SuiteProductId` union (0.85.0) but not yet in
// `DEFAULT_UNIVERSAL_APPS_PRODUCTS`, so with the stock catalogue the bar would
// render our icon with no name beside it and no Beam entry in the switcher.
//
// So we append one locally. This is a temporary shim with a clear exit: the
// moment the SDK ships a `beam` entry, delete this file and drop the `products`
// prop from App.tsx — the stock catalogue will already say the same thing.
//
// (`category: 'everyday'` matters. The switcher only lists products sharing the
// current product's category, so an uncategorised Beam would show the business
// apps alongside the everyday ones.)

const BEAM_GLYPH = (
  <svg viewBox="0 0 22 22" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="4" cy="11" r="2.2" />
    <circle cx="18" cy="11" r="2.2" />
    <path d="M7 11h8" />
    <path d="M12.5 8 15.5 11l-3 3" />
  </svg>
)

export const BEAM_PRODUCT_ENTRY: SuiteProduct = {
  id: 'beam',
  name: 'Universal Beam',
  desc: 'Send text straight between your devices',
  href: 'https://opensource.unisim.co.uk/beam',
  glyph: BEAM_GLYPH,
  category: 'everyday',
}

export const BEAM_CATALOGUE: SuiteProduct[] =
  DEFAULT_UNIVERSAL_APPS_PRODUCTS.some((p) => p.id === 'beam')
    ? DEFAULT_UNIVERSAL_APPS_PRODUCTS
    : [...DEFAULT_UNIVERSAL_APPS_PRODUCTS, BEAM_PRODUCT_ENTRY]
