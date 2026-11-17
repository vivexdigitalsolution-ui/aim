// Shared by apps/aim (full) and apps/lite: single-page app, the Supabase connection, sign-in state (useAuth) and one clock (useNow).
// Each app has its own .env with NUXT_PUBLIC_SUPABASE_URL / NUXT_PUBLIC_SUPABASE_KEY.
export default defineNuxtConfig({
  ssr: false,
  runtimeConfig: {
    public: {
      supabaseUrl: process.env.NUXT_PUBLIC_SUPABASE_URL || '',
      supabaseKey: process.env.NUXT_PUBLIC_SUPABASE_KEY || '',
    },
  },
})
