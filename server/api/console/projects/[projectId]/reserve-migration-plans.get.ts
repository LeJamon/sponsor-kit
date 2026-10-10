import { desc, eq } from 'drizzle-orm'
import { reserveMigrationPlans } from '~~/server/database/schema'
import { useDatabase } from '~~/server/utils/database'
import { requireProjectMember } from '~~/server/utils/project-member'

export default defineEventHandler(async (event) => {
  const { project } = await requireProjectMember(event, getRouterParam(event, 'projectId'))
  const plans = await useDatabase().select().from(reserveMigrationPlans)
    .where(eq(reserveMigrationPlans.projectId, project.id))
    .orderBy(desc(reserveMigrationPlans.createdAt), desc(reserveMigrationPlans.id)).limit(50)
  return { plans }
})
