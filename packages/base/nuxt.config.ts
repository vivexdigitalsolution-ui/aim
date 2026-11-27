// Shared by apps/aim (full) and apps/lite: single-page app, the Supabase connection, sign-in state (useAuth) and one clock (useNow).
// Each app has its own .env with NUXT_PUBLIC_SUPABASE_URL / NUXT_PUBLIC_SUPABASE_KEY.
export default defineNuxtConfig({
  ssr: false,
  runtimeConfig: {
    public: {
      appKind: 'full',
      supabaseUrl: process.env.NUXT_PUBLIC_SUPABASE_URL || '',
      supabaseKey: process.env.NUXT_PUBLIC_SUPABASE_KEY || '',
      // Google FCM (phone and browser notifications): Firebase console > Project settings > Your apps (Web). Empty = notifications show as "not set up yet".
      firebase: {
        apiKey: process.env.NUXT_PUBLIC_FIREBASE_API_KEY || '', authDomain: process.env.NUXT_PUBLIC_FIREBASE_AUTH_DOMAIN || '', projectId: process.env.NUXT_PUBLIC_FIREBASE_PROJECT_ID || '',
        messagingSenderId: process.env.NUXT_PUBLIC_FIREBASE_SENDER_ID || '', appId: process.env.NUXT_PUBLIC_FIREBASE_APP_ID || '', vapidKey: process.env.NUXT_PUBLIC_FIREBASE_VAPID_KEY || '',
      },
    },
  },
})
