export default defineNuxtRouteMiddleware(async (to) => {
  const { init, user, profile, isStaff } = useAuth()
  await init()

  if (!user.value) return to.path === '/login' ? undefined : navigateTo('/login')
  if (to.path === '/login') return navigateTo(isStaff.value ? '/review' : '/search')

  // signed in, but waiting for approval or suspended
  if (!profile.value || profile.value.status !== 'active') return to.path === '/pending' ? undefined : navigateTo('/pending')
  if (to.path === '/pending') return navigateTo('/')

  if (to.path.startsWith('/review') && !isStaff.value) return navigateTo('/')
})
