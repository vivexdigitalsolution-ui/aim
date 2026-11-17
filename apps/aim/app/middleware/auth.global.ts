export default defineNuxtRouteMiddleware(async (to) => {
  const { init, user, profile, isStaff, hasTier } = useAuth()
  // a personal list link opens without a login (the long random token is the key)
  if (to.path.startsWith('/t/') || to.path === '/reset') return
  await init()

  if (!user.value) return to.path === '/login' ? undefined : navigateTo({ path: '/login', query: to.fullPath === '/' ? {} : { next: to.fullPath } })
  if (to.path === '/login') return navigateTo(hasTier('member') ? '/today' : '/cars')

  // signed in, but waiting for approval or suspended
  if (!profile.value || profile.value.status !== 'active') return to.path === '/pending' ? undefined : navigateTo('/pending')
  if (to.path === '/pending') return navigateTo('/')

  if (['/review', '/bids', '/aps', '/status', '/market', '/lists', '/kpi'].some((p) => to.path.startsWith(p)) && !isStaff.value) return navigateTo('/')
  // margin screens: member tier and up (the server enforces it too: ap_lot_costs, market_stats and lot_catalog need the tier)
  if (['/today', '/margin', '/explorer'].some((p) => to.path.startsWith(p)) && !hasTier('member')) return navigateTo('/upgrade')
})
