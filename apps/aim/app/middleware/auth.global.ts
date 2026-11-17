export default defineNuxtRouteMiddleware(async (to) => {
  const { init, user, profile, isStaff } = useAuth()
  await init()

  if (!user.value) return to.path === '/login' ? undefined : navigateTo('/login')
  if (to.path === '/login') return navigateTo(isStaff.value ? '/today' : '/search')

  // signed in, but waiting for approval or suspended
  if (!profile.value || profile.value.status !== 'active') return to.path === '/pending' ? undefined : navigateTo('/pending')
  if (to.path === '/pending') return navigateTo('/')

  // duty (and so margin) is staff-only data for now
  if (['/review', '/today', '/margin'].some((p) => to.path.startsWith(p)) && !isStaff.value) return navigateTo('/')
})
