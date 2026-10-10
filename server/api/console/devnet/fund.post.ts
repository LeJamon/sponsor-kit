import { randomUUID } from 'node:crypto'
import { and, count, eq, gte, sql } from 'drizzle-orm'
import { z } from 'zod'
import { auditLogs } from '~~/server/database/schema'
import { loadSponsorProtocolDefinitions, parseDefinitionsHashAllowlist } from '~~/server/services/xrpl/definitions'
import { useDatabase } from '~~/server/utils/database'
import { xrplAccountSchema } from '~~/server/utils/intent-request'
import { requireProjectMember } from '~~/server/utils/project-member'
import { requireSameOrigin } from '~~/server/utils/same-origin'
import { xrplRpc } from '~~/server/utils/xrpl-rpc'

const bodySchema = z.object({ account: xrplAccountSchema }).strict()
const action = 'devnet.faucet.requested'

export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const context = await requireProjectMember(event)
  if (context.project.status !== 'active') throw createError({ statusCode: 409, statusMessage: 'Project is paused' })
  if (context.membership.role === 'viewer') throw createError({ statusCode: 403, statusMessage: 'Developer access is required' })
  if (context.project.network !== 'devnet') throw createError({ statusCode: 409, statusMessage: 'The faucet supports Devnet only' })
  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'A valid Devnet account address is required' })
  await loadSponsorProtocolDefinitions({ rpcUrl: context.project.rpcUrl, allowedHashes: parseDefinitionsHashAllowlist(process.env.ACME_XRPL_DEFINITIONS_HASHES) })
  const actor = `user:${context.session.user.id}`
  const database = useDatabase()
  const auditId = randomUUID()
  const day = new Date()
  day.setUTCHours(0, 0, 0, 0)
  await database.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('acme:devnet:faucet'))`)
    const conditions = and(eq(auditLogs.action, action), gte(auditLogs.createdAt, day))
    const [total] = await tx.select({ value: count() }).from(auditLogs).where(conditions)
    const [personal] = await tx.select({ value: count() }).from(auditLogs).where(and(conditions, eq(auditLogs.actor, actor)))
    if ((personal?.value || 0) >= 3 || (total?.value || 0) >= 50) {
      throw createError({ statusCode: 429, statusMessage: 'The demo faucet allowance has been reached. Try again tomorrow or fund the address through the Devnet faucet.' })
    }
    await tx.insert(auditLogs).values({
      id: auditId, organizationId: context.organization.id, projectId: context.project.id,
      actor, action, resourceType: 'devnet_account', resourceId: parsed.data.account,
      result: 'requested', requestId: randomUUID(), metadata: {}
    })
  })
  try {
    const response = await fetch('https://faucet.devnet.rippletest.net/accounts', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ destination: parsed.data.account }),
      signal: AbortSignal.timeout(15_000), redirect: 'error'
    })
    if (!response.ok) throw new Error('Faucet request failed')
    // The faucet may include key material in other modes; never forward its response.
    await response.body?.cancel()
    await database.update(auditLogs).set({ result: 'accepted' }).where(eq(auditLogs.id, auditId))
  } catch {
    await database.update(auditLogs).set({ result: 'unconfirmed' }).where(eq(auditLogs.id, auditId))
    throw createError({ statusCode: 503, statusMessage: 'The faucet request could not be confirmed. Check the address on Devnet before requesting funding again.' })
  }
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const account = await xrplRpc<{ account_data: { Balance: string }, ledger_index: number }>(context.project.rpcUrl, 'account_info', { account: parsed.data.account, ledger_index: 'validated', strict: true }, { retries: 0, timeoutMs: 2_000 })
      return { account: parsed.data.account, funded: true, pending: false, balanceDrops: account.account_data.Balance, ledgerIndex: account.ledger_index }
    } catch {
      if (attempt < 5) await new Promise(resolve => setTimeout(resolve, 1_000))
    }
  }
  setResponseStatus(event, 202)
  return { account: parsed.data.account, funded: false, pending: true, balanceDrops: null, ledgerIndex: null }
})
