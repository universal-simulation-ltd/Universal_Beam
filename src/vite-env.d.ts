/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

declare const __APP_VERSION__: string

interface ImportMetaEnv {
  /** Origin of the rendezvous Worker. Empty string = same origin (production).
   *  Set in `.env.local` to point dev at a local `wrangler dev` of
   *  backoffice/opensource-portal instead of the live one. */
  readonly VITE_RENDEZVOUS_ORIGIN?: string
  readonly VITE_PLATFORM_SUPABASE_URL?: string
  readonly VITE_PLATFORM_SUPABASE_ANON_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
