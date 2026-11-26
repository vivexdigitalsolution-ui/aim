export default defineNuxtRouteMiddleware(async (to) => {
  const { init, user, profile, isStaff } = useAuth()
  if (to.path === '/reset') return       // the e-mail link to choose a new password
  await init()
  if (to.path === '/about') return       // the PAW-J introduction: open to everyone, signed in or not
  if (!user.value) return to.path === '/login' ? undefined : navigateTo('/login')
  if (to.path === '/login') return navigateTo('/')
  // signed in, but waiting for approval or suspended
  if (!profile.value || profile.value.status !== 'active') return to.path === '/pending' ? undefined : navigateTo('/pending')
  if (to.path === '/pending') return navigateTo('/')
  // dealers' own pages: staff place the dealers' bids in the Bid queue, they have no favourites or orders of their own
  if (['/orders', '/watchlist'].some((p) => to.path.startsWith(p)) && isStaff.value) return navigateTo('/')
  // dealer-office pages: staff only (the server enforces it too)
  if (['/bids', '/aps', '/offer', '/targets'].some((p) => to.path.startsWith(p)) && !isStaff.value) return navigateTo('/')
})
