import type { H3Event } from 'h3'
import { auth } from '~~/lib/auth'
import { hasPlatformAdminRole } from '~~/lib/roles'

export async function requirePlatformAdmin(event: H3Event) {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user) throw createError({ statusCode: 401, statusMessage: 'Authentication required' })
  if (!hasPlatformAdminRole(session.user.role)) throw createError({ statusCode: 403, statusMessage: 'Platform administrator access required' })
  return session
}
