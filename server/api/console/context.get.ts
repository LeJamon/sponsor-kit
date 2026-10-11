import { and, asc, eq, ne } from 'drizzle-orm'
import { auth } from '~~/lib/auth'
import { hasPlatformAdminRole } from '~~/lib/roles'
import { organizationMemberships, organizations, projects } from '~~/server/database/schema'
import { useDatabase } from '~~/server/utils/database'

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user) throw createError({ statusCode: 401, statusMessage: 'Authentication required' })
  const database = useDatabase()
  const [organizationRows, projectRows] = await Promise.all([
    database.select({ organization: organizations, role: organizationMemberships.role })
      .from(organizationMemberships)
      .innerJoin(organizations, eq(organizations.id, organizationMemberships.organizationId))
      .where(and(eq(organizationMemberships.userId, session.user.id), eq(organizations.status, 'active')))
      .orderBy(asc(organizations.createdAt)),
    database.select({ membership: organizationMemberships, organization: organizations, project: projects })
      .from(organizationMemberships)
      .innerJoin(organizations, eq(organizations.id, organizationMemberships.organizationId))
      .innerJoin(projects, eq(projects.organizationId, organizations.id))
      .where(and(
        eq(organizationMemberships.userId, session.user.id),
        eq(organizations.status, 'active'),
        ne(projects.status, 'archived')
      ))
      .orderBy(asc(projects.createdAt))
  ])
  return {
    user: { id: session.user.id, name: session.user.name, email: session.user.email, image: session.user.image, platformAdmin: hasPlatformAdminRole(session.user.role) },
    onboarded: organizationRows.length > 0,
    organizations: organizationRows,
    projects: projectRows.map(row => ({ organization: row.organization, project: row.project, role: row.membership.role }))
  }
})
