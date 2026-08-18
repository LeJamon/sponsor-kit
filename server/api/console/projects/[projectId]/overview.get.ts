import { and, count, desc, eq, inArray } from 'drizzle-orm'
import { sponsorshipIntents, sponsorshipPolicies } from '~~/server/database/schema'
import { readProjectFunding } from '~~/server/services/funding'
import { useDatabase } from '~~/server/utils/database'
import { requireProjectMember } from '~~/server/utils/project-member'

export default defineEventHandler(async (event) => {
  const context = await requireProjectMember(event, getRouterParam(event, 'projectId'))
  const database = useDatabase()
  const [validated, pending, failed, recent, policyCount, funding] = await Promise.all([
    database.select({ value: count() }).from(sponsorshipIntents).where(and(eq(sponsorshipIntents.projectId, context.project.id), eq(sponsorshipIntents.state, 'validated'))),
    database.select({ value: count() }).from(sponsorshipIntents).where(and(eq(sponsorshipIntents.projectId, context.project.id), inArray(sponsorshipIntents.state, ['created', 'awaiting_user_signature', 'user_signature_received', 'verified', 'awaiting_sponsor_signature', 'submitting', 'submitted']))),
    database.select({ value: count() }).from(sponsorshipIntents).where(and(eq(sponsorshipIntents.projectId, context.project.id), inArray(sponsorshipIntents.state, ['failed', 'rejected', 'expired', 'cancelled']))),
    database.select().from(sponsorshipIntents).where(eq(sponsorshipIntents.projectId, context.project.id)).orderBy(desc(sponsorshipIntents.createdAt)).limit(5),
    database.select({ value: count() }).from(sponsorshipPolicies).where(and(eq(sponsorshipPolicies.projectId, context.project.id), eq(sponsorshipPolicies.status, 'active'))),
    readProjectFunding({ projectId: context.project.id, rpcUrl: context.project.rpcUrl, network: context.project.network })
  ])
  return {
    project: context.project,
    organization: context.organization,
    role: context.membership.role,
    metrics: { validated: validated[0]?.value || 0, pending: pending[0]?.value || 0, failed: failed[0]?.value || 0, activePolicies: policyCount[0]?.value || 0 },
    funding: funding?.balance || null,
    signer: funding?.sponsor || null,
    recentIntents: recent.map(intent => ({ ...intent, estimatedFeeDrops: intent.estimatedFeeDrops.toString(), estimatedReserveDrops: intent.estimatedReserveDrops.toString() }))
  }
})
