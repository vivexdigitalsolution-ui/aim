// The LITE app: a plain marketplace of the open auction cars with prices in RM and bid orders. No margin tools, no market data, no duty.
// Same logic package (@aim/core) and the same base layer (Supabase, sign-in) as the full app; its own look (light, marketplace style).
export default defineNuxtConfig({
  extends: ['../../packages/base'],
  compatibilityDate: '2026-01-01',
  ssr: false,
  devtools: { enabled: false },
  css: ['~/assets/lite.css'],
  build: { transpile: ['@aim/core'] },
  runtimeConfig: { public: { appKind: 'lite' } },      // the shared pages (My account, the import price box) read this to show the lite wording and lite defaults
  app: {
    head: {
      title: 'PAW-J Partner',
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
        { name: 'theme-color', content: '#ffffff' },
      ],
    },
  },
})
