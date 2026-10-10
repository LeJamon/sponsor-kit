import { createHash, timingSafeEqual } from 'node:crypto'
import type { H3Event } from 'h3'
import { and, eq, gt, isNull, or } from 'drizzle-orm'
import { apiKeys, organizations, projects, sponsorshipIntents } from '../database/schema'
import { useDatabase } from './database'

export function hashApiKey(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex')
}

export function constantTimeHashEquals(secret: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashApiKey(secret), 'hex')
  const expected = Buffer.from(expectedHash, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export function readBearerToken(event: H3Event): string {
  const header = getHeader(event, 'authorization')
  if (!header?.startsWith('Bearer ')) throw createError({ statusCode: 401, statusMessage: 'Missing bearer API key' })
  return header.slice(7)
}

export async function requireProjectApiKey(event: H3Event, projectPublicId: string, requiredScope: string, options: { requireActiveProject?: boolean } = {}) {
  const token = readBearerToken(event)
  const secretHash = hashApiKey(token)
  const projectStatus = options.requireActiveProject === false ? undefined : eq(projects.status, 'active')
  const rows = await useDatabase().select({
    apiKeyId: apiKeys.id,
    scopes: apiKeys.scopes,
    project: projects
  }).from(apiKeys).innerJoin(projects, eq(apiKeys.projectId, projects.id)).innerJoin(organizations, eq(organizations.id, projects.organizationId)).where(and(
    eq(apiKeys.secretHash, secretHash),
    eq(projects.publicId, projectPublicId),
    projectStatus,
    eq(organizations.status, 'active'),
    isNull(apiKeys.revokedAt),
    or(isNull(apiKeys.expiresAt), gt(apiKeys.expiresAt, new Date()))
  )).limit(1)
  const principal = rows[0]
  if (!principal || !principal.scopes.includes(requiredScope)) throw createError({ statusCode: 403, statusMessage: 'API key is invalid or lacks the required scope' })
  await useDatabase().update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, principal.apiKeyId))
  return principal
}

export async function requireIntentApiKey(event: H3Event, intentId: string, requiredScope: string) {
  const token = readBearerToken(event)
  const secretHash = hashApiKey(token)
  const rows = await useDatabase().select({
    apiKeyId: apiKeys.id,
    scopes: apiKeys.scopes,
    project: projects
  }).from(apiKeys)
    .innerJoin(projects, eq(apiKeys.projectId, projects.id))
    .innerJoin(organizations, eq(organizations.id, projects.organizationId))
    .innerJoin(sponsorshipIntents, eq(sponsorshipIntents.projectId, projects.id))
    .where(and(
      eq(sponsorshipIntents.id, intentId),
      eq(apiKeys.secretHash, secretHash),
      eq(organizations.status, 'active'),
      isNull(apiKeys.revokedAt),
      or(isNull(apiKeys.expiresAt), gt(apiKeys.expiresAt, new Date()))
    )).limit(1)
  const principal = rows[0]
  if (!principal || !principal.scopes.includes(requiredScope)) throw createError({ statusCode: 403, statusMessage: 'API key is invalid or lacks the required scope' })
  await useDatabase().update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, principal.apiKeyId))
  return principal
}
