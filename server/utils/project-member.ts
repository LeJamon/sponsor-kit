import type { H3Event } from 'h3'
import { and, asc, eq, ne } from 'drizzle-orm'
import { auth } from '~~/lib/auth'
import { organizationMemberships, organizations, projects } from '../database/schema'
import { useDatabase } from './database'

export async function requireProjectMember(event: H3Event, projectPublicId?: string, options: { includeArchived?: boolean } = {}) {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user) throw createError({ statusCode: 401, statusMessage: 'Authentication required' })
  const projectStatus = options.includeArchived ? undefined : ne(projects.status, 'archived')
  const where = projectPublicId
    ? and(eq(organizationMemberships.userId, session.user.id), eq(projects.publicId, projectPublicId), eq(organizations.status, 'active'), projectStatus)
    : and(eq(organizationMemberships.userId, session.user.id), eq(organizations.status, 'active'), projectStatus)
  const [membership] = await useDatabase().select({ membership: organizationMemberships, organization: organizations, project: projects })
    .from(organizationMemberships)
    .innerJoin(organizations, eq(organizations.id, organizationMemberships.organizationId))
    .innerJoin(projects, eq(projects.organizationId, organizations.id))
    .where(where)
    .orderBy(asc(projects.createdAt))
    .limit(1)
  if (!membership) throw createError({ statusCode: 404, statusMessage: 'No accessible project found', data: { code: 'ONBOARDING_REQUIRED' } })
  return { session, ...membership }
}

export function requireProjectManagementRole(role: string) {
  if (!['owner', 'admin'].includes(role)) throw createError({ statusCode: 403, statusMessage: 'Project administrator access required' })
}
