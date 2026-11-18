export default defineNuxtRouteMiddleware(async (to) => {
  const { init, user, profile, isStaff, hasTier, customerExpired, signOut } = useAuth()
  // a personal list link opens without a login (the long random token is the key); /join is where a walk-in customer signs up with a code
  if (to.path.startsWith('/t/') || to.path === '/reset' || to.path === '/join') return
  await init()

  if (!user.value) return to.path === '/login' ? undefined : navigateTo({ path: '/login', query: to.fullPath === '/' ? {} : { next: to.fullPath } })
  // a walk-in customer: only their own cars, only for the time staff set
  if (profile.value?.role === 'customer') {
    if (customerExpired() || profile.value.status !== 'active') { await signOut(); return navigateTo({ path: '/login', query: { ended: '1' } }) }
    return to.path.startsWith('/for-you') || to.path === '/account' ? undefined : navigateTo('/for-you')
  }
  if (to.path === '/login') return navigateTo(hasTier('member') ? '/today' : '/cars')

  // signed in, but waiting for approval or suspended
  if (!profile.value || profile.value.status !== 'active') return to.path === '/pending' ? undefined : navigateTo('/pending')
  if (to.path === '/pending') return navigateTo('/')

  if (['/review', '/bids', '/aps', '/status', '/market', '/lists', '/kpi', '/segments', '/customers'].some((p) => to.path.startsWith(p)) && !isStaff.value) return navigateTo('/')
  // margin screens: member tier and up (the server enforces it too: ap_lot_costs, market_stats and lot_catalog need the tier)
  if (['/today', '/margin', '/explorer', '/history'].some((p) => to.path.startsWith(p)) && !hasTier('member')) return navigateTo('/upgrade')
})
