import type { SupabaseClient } from '@supabase/supabase-js'

export const useDb = () => useNuxtApp().$supabase as SupabaseClient

/** One shared clock (updated every 30 s) so every countdown on screen ticks together. */
export const useNow = () => useState<number>('now', () => Date.now())
