// Single-page app (no server): `nuxt generate` writes static files to .output/public, which the website host and the
// Capacitor Android app both serve. The logic comes from the shared @aim/core package (also used by the lite app and the scraper).
export default defineNuxtConfig({
  compatibilityDate: '2026-01-01',
  ssr: false,
  devtools: { enabled: false },
  css: ['~/assets/main.css'],
  build: { transpile: ['@aim/core'] },
  runtimeConfig: {
    public: {
      supabaseUrl: process.env.NUXT_PUBLIC_SUPABASE_URL || '',
      supabaseKey: process.env.NUXT_PUBLIC_SUPABASE_KEY || '',
    },
  },
  app: {
    pageTransition: { name: 'page', mode: 'out-in' },
    head: {
      title: 'AIM - Auction Import Margin',
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
        { name: 'theme-color', content: '#0f0f11' },
      ],
    },
  },
})
