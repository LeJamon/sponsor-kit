import { and, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { auditLogs, outboxEvents } from '~~/server/database/schema'
import { requirePlatformAdmin } from '~~/server/utils/admin'
import { useDatabase } from '~~/server/utils/database'
import { requireSameOrigin } from '~~/server/utils/same-origin'

const schema = z.object({ expectedLockVersion: z.number().int().nonnegative().optional(), reason: z.string().trim().min(8).max(500) })

export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const session = await requirePlatformAdmin(event)
  const eventId = getRouterParam(event, 'eventId')
  if (!eventId) throw createError({ statusCode: 400, statusMessage: 'Outbox event ID is required' })
  const parsed = schema.safeParse(await readBody(event))
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Invalid dead-letter recovery request', data: parsed.error.flatten() })
  const requestId = getHeader(event, 'x-request-id') || crypto.randomUUID()
  return useDatabase().transaction(async (tx) => {
    const [current] = await tx.select().from(outboxEvents).where(eq(outboxEvents.id, eventId)).for('update').limit(1)
    if (!current) throw createError({ statusCode: 404, statusMessage: 'Dead-letter event not found' })
    if (!current.deadLetteredAt || current.processedAt) throw createError({ statusCode: 409, statusMessage: 'Outbox event is not currently dead-lettered' })
    if (parsed.data.expectedLockVersion !== undefined && parsed.data.expectedLockVersion !== current.lockVersion) throw createError({ statusCode: 409, statusMessage: 'Dead-letter event changed; refresh and retry', data: { currentLockVersion: current.lockVersion } })
    // Recovery only requeues the already signed payload. It never releases a
    // reservation and never creates a new sponsor signature.
    const [recovered] = await tx.update(outboxEvents).set({ deadLetteredAt: null, availableAt: new Date(), lockedAt: null, lockedBy: null, lockVersion: current.lockVersion + 1, lastError: `Manually requeued: ${parsed.data.reason}` }).where(and(eq(outboxEvents.id, eventId), isNull(outboxEvents.processedAt), eq(outboxEvents.lockVersion, current.lockVersion))).returning()
    if (!recovered) throw createError({ statusCode: 409, statusMessage: 'Dead-letter event changed; refresh and retry' })
    await tx.insert(auditLogs).values({ actor: session.user.email, action: 'outbox.dead_letter.recovered', resourceType: 'outbox_event', resourceId: eventId, result: 'success', requestId, metadata: { reason: parsed.data.reason, previousAttempts: current.attempts, eventType: current.eventType, aggregateId: current.aggregateId } })
    return recovered
  })
})
