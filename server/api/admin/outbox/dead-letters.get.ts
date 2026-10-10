import { count, desc, isNotNull } from 'drizzle-orm'
import { outboxEvents } from '~~/server/database/schema'
import { requirePlatformAdmin } from '~~/server/utils/admin'
import { useDatabase } from '~~/server/utils/database'

export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event)
  const rawLimit = Number(getQuery(event).limit || 50)
  const limit = Number.isInteger(rawLimit) ? Math.min(100, Math.max(1, rawLimit)) : 50
  const database = useDatabase()
  const [events, totals] = await Promise.all([
    database.select().from(outboxEvents).where(isNotNull(outboxEvents.deadLetteredAt)).orderBy(desc(outboxEvents.deadLetteredAt)).limit(limit),
    database.select({ value: count() }).from(outboxEvents).where(isNotNull(outboxEvents.deadLetteredAt))
  ])
  return {
    events,
    count: totals[0]?.value || 0
  }
})
