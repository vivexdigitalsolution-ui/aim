export interface Profile {
  id: string; role: 'admin' | 'staff' | 'ap_holder'; status: 'pending' | 'active' | 'suspended'
  company_name: string | null; contact_name: string | null; phone: string | null; whatsapp: string | null
  email: string | null; address: string | null
  bid_limit_jpy: number; open_limit_jpy: number | null; fee_rule_id: string | null; history_until: string | null
  suspended_reason: string | null; last_order_at: string | null; tier?: 'free' | 'member' | 'partner'
}

export function useAuth() {
  const db = useDb()
  const user = useState<any>('auth-user', () => null)
  const profile = useState<Profile | null>('auth-profile', () => null)
  const ready = useState('auth-ready', () => false)

  const isStaff = computed(() => profile.value?.role === 'admin' || profile.value?.role === 'staff')
  const isAdmin = computed(() => profile.value?.role === 'admin')
  const RANK: Record<string, number> = { free: 0, member: 1, partner: 2 }
  /** Staff pass every tier; an AP holder needs a tier at least `min` (a missing tier counts as member: the default). */
  const hasTier = (min: 'free' | 'member' | 'partner') => isStaff.value || (RANK[profile.value?.tier || 'member'] ?? 1) >= RANK[min]!
  const hasHistory = computed(() => !!profile.value?.history_until && profile.value.history_until >= new Date().toISOString().slice(0, 10))

  async function loadProfile() {
    if (!user.value) { profile.value = null; return }
    const { data } = await db.from('profiles').select('*').eq('id', user.value.id).maybeSingle()
    profile.value = (data as Profile) || null
  }

  let listening = false
  async function init() {
    if (ready.value) return
    const { data } = await db.auth.getSession()
    user.value = data.session?.user ?? null
    await loadProfile()
    ready.value = true
    if (!listening) {
      listening = true
      // do not await Supabase calls inside this callback (it can deadlock the auth client)
      db.auth.onAuthStateChange((_e, session) => {
        user.value = session?.user ?? null
        setTimeout(loadProfile, 0)
      })
    }
  }

  async function signIn(email: string, password: string) {
    const { error } = await db.auth.signInWithPassword({ email, password })
    if (error) throw error
    const { data } = await db.auth.getSession()
    user.value = data.session?.user ?? null
    await loadProfile()
  }

  async function signUp(email: string, password: string, meta: Record<string, string>) {
    const { data, error } = await db.auth.signUp({ email, password, options: { data: meta } })
    if (error) throw error
    return data
  }

  /** Sends the "choose a new password" e-mail. The answer never says whether the address has an account. */
  async function resetPassword(email: string) {
    const { error } = await db.auth.resetPasswordForEmail(email, { redirectTo: location.origin + '/reset' })
    if (error) throw error
  }

  async function signOut() {
    await db.auth.signOut()
    user.value = null
    profile.value = null
  }

  return { user, profile, ready, isStaff, isAdmin, hasTier, hasHistory, init, loadProfile, signIn, signUp, resetPassword, signOut }
}
