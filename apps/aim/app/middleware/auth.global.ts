export default defineNuxtRouteMiddleware(async (to) => {
  const { init, user, profile, isStaff, hasTier } = useAuth()
  await init()

  if (!user.value) return to.path === '/login' ? undefined : navigateTo('/login')
  if (to.path === '/login') return navigateTo(hasTier('member') ? '/today' : '/search')

  // signed in, but waiting for approval or suspended
  if (!profile.value || profile.value.status !== 'active') return to.path === '/pending' ? undefined : navigateTo('/pending')
  if (to.path === '/pending') return navigateTo('/')

  if (to.path.startsWith('/review') && !isStaff.value) return navigateTo('/')
  // margin screens: member tier and up (the server enforces it too: ap_lot_costs, market_stats and lot_catalog need the tier)
  if (['/today', '/margin'].some((p) => to.path.startsWith(p)) && !hasTier('member')) return navigateTo('/upgrade')
})
