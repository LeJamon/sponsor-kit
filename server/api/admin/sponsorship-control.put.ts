import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { auditLogs, platformControls } from '~~/server/database/schema'
import { requirePlatformAdmin } from '~~/server/utils/admin'
import { useDatabase } from '~~/server/utils/database'
import { requireSameOrigin } from '~~/server/utils/same-origin'

const schema = z.object({ paused: z.boolean(), expectedVersion: z.number().int().nonnegative(), reason: z.string().trim().min(8).max(500) })

export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const session = await requirePlatformAdmin(event)
  const parsed = schema.safeParse(await readBody(event))
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Invalid sponsorship control request', data: parsed.error.flatten() })
  const requestId = getHeader(event, 'x-request-id') || crypto.randomUUID()
  return useDatabase().transaction(async (tx) => {
    const [current] = await tx.select().from(platformControls).where(eq(platformControls.key, 'sponsorship')).for('update').limit(1)
    const currentVersion = current?.version || 0
    if (currentVersion !== parsed.data.expectedVersion) throw createError({ statusCode: 409, statusMessage: 'Sponsorship control changed; refresh and retry', data: { currentVersion } })
    const nextVersion = currentVersion + 1
    const now = new Date()
    const values = { paused: parsed.data.paused, version: nextVersion, reason: parsed.data.reason, updatedBy: session.user.id, updatedAt: now }
    const [control] = current
      ? await tx.update(platformControls).set(values).where(eq(platformControls.key, 'sponsorship')).returning()
      : await tx.insert(platformControls).values({ key: 'sponsorship', ...values }).returning()
    await tx.insert(auditLogs).values({ actor: session.user.email, action: parsed.data.paused ? 'sponsorship.paused' : 'sponsorship.resumed', resourceType: 'platform_control', resourceId: 'sponsorship', result: 'success', requestId, metadata: { reason: parsed.data.reason, previousVersion: currentVersion, version: nextVersion } })
    return control
  })
})
