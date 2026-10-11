import { randomBytes } from 'node:crypto'
import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm'
import { z } from 'zod'
import { auth } from '~~/lib/auth'
import { organizationMemberships, organizations, projects } from '~~/server/database/schema'
import { loadProjectProvisioningContext, provisionProject } from '../services/project-provisioning'
import { useDatabase } from '~~/server/utils/database'
import { requireSameOrigin } from '~~/server/utils/same-origin'

const schema = z.object({
  organizationName: z.string().trim().min(2).max(80),
  projectName: z.string().trim().min(2).max(80).default('My first project'),
  network: z.literal('devnet').default('devnet')
})

export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  const parsed = schema.safeParse(await readBody(event))
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Invalid organization', data: parsed.error.flatten() })
  const database = useDatabase()
  const context = await loadProjectProvisioningContext()
  const suffix = randomBytes(4).toString('hex')
  const slugBase = parsed.data.organizationName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'organization'
  const result = await database.transaction(async (tx) => {
    // PostgreSQL advisory locks serialize the first-project check for a user,
    // including concurrent browser retries where no membership row exists yet.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`onboarding:${session.user.id}`}))`)
    const [existingProject] = await tx.select({ organization: organizations, project: projects }).from(organizationMemberships)
      .innerJoin(organizations, eq(organizations.id, organizationMemberships.organizationId))
      .innerJoin(projects, eq(projects.organizationId, organizations.id))
      .where(and(
        eq(organizationMemberships.userId, session.user.id),
        eq(organizations.status, 'active'),
        ne(projects.status, 'archived')
      )).orderBy(asc(projects.createdAt)).limit(1)
    if (existingProject) return { created: false, value: existingProject }

    // A user may still have an accessible workspace after deleting its last
    // project. Reuse that organization so onboarding never resurrects the
    // archived project or creates an unnecessary second workspace.
    const [existingOrganization] = await tx.select({ organization: organizations }).from(organizationMemberships)
      .innerJoin(organizations, eq(organizations.id, organizationMemberships.organizationId))
      .where(and(
        eq(organizationMemberships.userId, session.user.id),
        eq(organizations.status, 'active'),
        inArray(organizationMemberships.role, ['owner', 'admin'])
      ))
      .orderBy(asc(organizations.createdAt)).limit(1)
    if (existingOrganization) {
      const [project] = await tx.insert(projects).values({ organizationId: existingOrganization.organization.id, name: parsed.data.projectName, publicId: `proj_${randomBytes(8).toString('hex')}`, environment: 'development', network: parsed.data.network, rpcUrl: context.rpcUrl }).returning()
      if (!project) throw new Error('Project creation failed')
      await provisionProject(tx, { projectId: project.id, publishedBy: session.user.id, context })
      return { created: true, value: { organization: existingOrganization.organization, project } }
    }

    const [organization] = await tx.insert(organizations).values({ name: parsed.data.organizationName, slug: `${slugBase}-${suffix}` }).returning()
    if (!organization) throw new Error('Organization creation failed')
    await tx.insert(organizationMemberships).values({ organizationId: organization.id, userId: session.user.id, role: 'owner' })
    const [project] = await tx.insert(projects).values({ organizationId: organization.id, name: parsed.data.projectName, publicId: `proj_${randomBytes(8).toString('hex')}`, environment: 'development', network: parsed.data.network, rpcUrl: context.rpcUrl }).returning()
    if (!project) throw new Error('Project creation failed')
    await provisionProject(tx, { projectId: project.id, publishedBy: session.user.id, context })
    return { created: true, value: { organization, project } }
  })
  setResponseStatus(event, result.created ? 201 : 200)
  return result.value
})
