import { authClient } from '~~/lib/auth-client'
import { hasPlatformAdminRole } from '~~/lib/roles'

export default defineNuxtRouteMiddleware(async (to) => {
  if (!to.path.startsWith('/app') && !to.path.startsWith('/admin')) return
  const isAdminRoute = to.path.startsWith('/admin')
  const { data: session } = await authClient.useSession(useFetch)
  if (!session.value) return navigateTo({ path: '/sign-in', query: { redirect: to.fullPath } })
  if (isAdminRoute && !hasPlatformAdminRole(session.value.user.role)) {
    return navigateTo({ path: '/app', query: { error: 'admin_required' } })
  }
})
