export default defineNuxtRouteMiddleware(async (to) => {
  const { init, user, profile, isStaff } = useAuth()
  if (to.path === '/reset') return       // the e-mail link to choose a new password
  await init()
  if (!user.value) return to.path === '/login' ? undefined : navigateTo('/login')
  if (to.path === '/login') return navigateTo('/')
  // signed in, but waiting for approval or suspended
  if (!profile.value || profile.value.status !== 'active') return to.path === '/pending' ? undefined : navigateTo('/pending')
  if (to.path === '/pending') return navigateTo('/')
  // dealer-office pages: staff only (the server enforces it too)
  if (['/bids', '/aps', '/offer', '/targets'].some((p) => to.path.startsWith(p)) && !isStaff.value) return navigateTo('/')
})
