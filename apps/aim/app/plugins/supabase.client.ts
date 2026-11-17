import { createClient } from '@supabase/supabase-js'

export default defineNuxtPlugin(() => {
  const { supabaseUrl, supabaseKey } = useRuntimeConfig().public
  if (!supabaseUrl || !supabaseKey) throw new Error('Supabase is not configured: set NUXT_PUBLIC_SUPABASE_URL and NUXT_PUBLIC_SUPABASE_KEY in .env')
  const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } })
  return { provide: { supabase } }
})
