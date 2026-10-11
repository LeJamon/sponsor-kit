import { randomUUID } from 'node:crypto'
import { and, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { auditLogs, projects, sponsorshipPolicies } from '~~/server/database/schema'
import { canonicalHash } from '~~/server/domain/canonical-json'
import { policyDocumentSchema, validatePolicyDocument } from '~~/server/domain/policy'
import { useDatabase } from '~~/server/utils/database'
import { requireProjectManagementRole, requireProjectMember } from '~~/server/utils/project-member'
import { requireSameOrigin } from '~~/server/utils/same-origin'

const schema = z.object({ name: z.string().trim().min(2).max(80), document: policyDocumentSchema, activate: z.boolean().default(true) })

export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const context = await requireProjectMember(event, getRouterParam(event, 'projectId'))
  requireProjectManagementRole(context.membership.role)
  const parsed = schema.safeParse(await readBody(event))
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Invalid sponsorship policy', data: parsed.error.flatten() })
  let document
  try {
    document = validatePolicyDocument(parsed.data.document)
  } catch (validationError: unknown) {
    throw createError({ statusCode: 400, statusMessage: validationError instanceof Error ? validationError.message : 'Invalid sponsorship policy destinations' })
  }
  const id = randomUUID()
  const now = new Date()
  const policy = await useDatabase().transaction(async (tx) => {
    // Serialize all version allocation for a project. This also covers the
    // first version of a policy name, where no previous row exists to lock.
    const [project] = await tx.select({ id: projects.id, status: projects.status }).from(projects).where(eq(projects.id, context.project.id)).for('update').limit(1)
    if (!project || project.status === 'archived') throw createError({ statusCode: 404, statusMessage: 'Project not found' })
    const [previous] = await tx.select().from(sponsorshipPolicies).where(and(eq(sponsorshipPolicies.projectId, context.project.id), eq(sponsorshipPolicies.name, parsed.data.name))).orderBy(desc(sponsorshipPolicies.version)).for('update').limit(1)
    const version = (previous?.version || 0) + 1
    if (parsed.data.activate) await tx.update(sponsorshipPolicies).set({ status: 'paused' }).where(and(eq(sponsorshipPolicies.projectId, context.project.id), eq(sponsorshipPolicies.name, parsed.data.name), eq(sponsorshipPolicies.status, 'active')))
    const [created] = await tx.insert(sponsorshipPolicies).values({ id, projectId: context.project.id, name: parsed.data.name, version, status: parsed.data.activate ? 'active' : 'draft', document, documentHash: canonicalHash(document), publishedBy: parsed.data.activate ? context.session.user.id : null, publishedAt: parsed.data.activate ? now : null }).returning()
    await tx.insert(auditLogs).values({ organizationId: context.organization.id, projectId: context.project.id, actor: context.session.user.email, action: parsed.data.activate ? 'project.policy.published' : 'project.policy.created', resourceType: 'sponsorship_policy', resourceId: id, result: 'success', requestId: getHeader(event, 'x-request-id') || randomUUID(), metadata: { name: parsed.data.name, version } })
    return created
  })
  setResponseStatus(event, 201)
  return policy
})
