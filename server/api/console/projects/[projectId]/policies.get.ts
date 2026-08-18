import { desc, eq } from 'drizzle-orm'
import { sponsorshipPolicies } from '~~/server/database/schema'
import { useDatabase } from '~~/server/utils/database'
import { requireProjectMember } from '~~/server/utils/project-member'

export default defineEventHandler(async (event) => {
  const context = await requireProjectMember(event, getRouterParam(event, 'projectId'))
  return useDatabase().select().from(sponsorshipPolicies).where(eq(sponsorshipPolicies.projectId, context.project.id)).orderBy(desc(sponsorshipPolicies.createdAt))
})
