import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { auth } from '~~/lib/auth'
import { organizationMemberships, organizations, projects } from '~~/server/database/schema'
import { loadProjectProvisioningContext, projectPublicIdForRequest, provisionProject } from '../../../services/project-provisioning'
import { useDatabase } from '~~/server/utils/database'
import { requireSameOrigin } from '~~/server/utils/same-origin'

const schema = z.object({
  organizationId: z.string().uuid(),
  name: z.string().trim().min(2).max(80),
  requestId: z.string().uuid()
})

export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user) throw createError({ statusCode: 401, statusMessage: 'Authentication required' })
  const parsed = schema.safeParse(await readBody(event))
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Invalid project request', data: parsed.error.flatten() })

  const database = useDatabase()
  const [membership] = await database.select({ membership: organizationMemberships, organization: organizations })
    .from(organizationMemberships)
    .innerJoin(organizations, eq(organizations.id, organizationMemberships.organizationId))
    .where(and(
      eq(organizationMemberships.organizationId, parsed.data.organizationId),
      eq(organizationMemberships.userId, session.user.id),
      eq(organizations.status, 'active')
    )).limit(1)
  if (!membership || !['owner', 'admin'].includes(membership.membership.role)) {
    throw createError({ statusCode: 403, statusMessage: 'Organization administrator access required' })
  }

  const context = await loadProjectProvisioningContext()
  const publicId = projectPublicIdForRequest({ userId: session.user.id, organizationId: parsed.data.organizationId, requestId: parsed.data.requestId })
  const result = await database.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`project-creation:${publicId}`}))`)
    const [existing] = await tx.select().from(projects).where(eq(projects.publicId, publicId)).limit(1)
    if (existing) {
      if (existing.organizationId !== parsed.data.organizationId || existing.name !== parsed.data.name) {
        throw createError({ statusCode: 409, statusMessage: 'Request ID was already used for a different project' })
      }
      return { created: false, project: existing }
    }

    const [project] = await tx.insert(projects).values({
      organizationId: parsed.data.organizationId,
      name: parsed.data.name,
      publicId,
      environment: 'development',
      network: 'devnet',
      rpcUrl: context.rpcUrl
    }).returning()
    if (!project) throw new Error('Project creation failed')
    await provisionProject(tx, { projectId: project.id, publishedBy: session.user.id, context })
    return { created: true, project }
  })
  setResponseStatus(event, result.created ? 201 : 200)
  return { project: result.project, organization: membership.organization }
})
