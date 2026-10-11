import { randomBytes } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { auth } from '~~/lib/auth'
import { organizationMemberships, organizations, projects } from '~~/server/database/schema'
import { loadProjectProvisioningContext, provisionProject } from '../services/project-provisioning'
import { useDatabase } from '~~/server/utils/database'
import { requireSameOrigin } from '~~/server/utils/same-origin'

const schema = z.object({ organizationName: z.string().trim().min(2).max(80) })

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
    const [existing] = await tx.select({ organization: organizations, project: projects }).from(organizationMemberships)
      .innerJoin(organizations, eq(organizations.id, organizationMemberships.organizationId))
      .innerJoin(projects, eq(projects.organizationId, organizations.id))
      .where(eq(organizationMemberships.userId, session.user.id)).limit(1)
    if (existing) return { created: false, value: existing }
    const [organization] = await tx.insert(organizations).values({ name: parsed.data.organizationName, slug: `${slugBase}-${suffix}` }).returning()
    if (!organization) throw new Error('Organization creation failed')
    await tx.insert(organizationMemberships).values({ organizationId: organization.id, userId: session.user.id, role: 'owner' })
    const [project] = await tx.insert(projects).values({ organizationId: organization.id, name: 'My first project', publicId: `proj_${randomBytes(8).toString('hex')}`, environment: 'development', network: 'devnet', rpcUrl: context.rpcUrl }).returning()
    if (!project) throw new Error('Project creation failed')
    await provisionProject(tx, { projectId: project.id, publishedBy: session.user.id, context })
    return { created: true, value: { organization, project } }
  })
  setResponseStatus(event, result.created ? 201 : 200)
  return result.value
})
