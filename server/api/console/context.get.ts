import { asc, eq } from 'drizzle-orm'
import { auth } from '~~/lib/auth'
import { hasPlatformAdminRole } from '~~/lib/roles'
import { organizationMemberships, organizations, projects } from '~~/server/database/schema'
import { useDatabase } from '~~/server/utils/database'

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user) throw createError({ statusCode: 401, statusMessage: 'Authentication required' })
  const rows = await useDatabase().select({ membership: organizationMemberships, organization: organizations, project: projects })
    .from(organizationMemberships)
    .innerJoin(organizations, eq(organizations.id, organizationMemberships.organizationId))
    .innerJoin(projects, eq(projects.organizationId, organizations.id))
    .where(eq(organizationMemberships.userId, session.user.id))
    .orderBy(asc(projects.createdAt))
  return {
    user: { id: session.user.id, name: session.user.name, email: session.user.email, image: session.user.image, platformAdmin: hasPlatformAdminRole(session.user.role) },
    onboarded: rows.length > 0,
    projects: rows.map(row => ({ organization: row.organization, project: row.project, role: row.membership.role }))
  }
})
