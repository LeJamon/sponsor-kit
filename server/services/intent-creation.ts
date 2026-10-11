import { createHash, createHmac, randomUUID } from 'node:crypto'
import { and, count, desc, eq, gte } from 'drizzle-orm'
import { intentEvents, projectSponsorAccounts, projects, sponsorAccounts, sponsorTreasuries, sponsorshipGrants, sponsorshipIntents, sponsorshipPolicies } from '../database/schema'
import { canonicalHash } from '../domain/canonical-json'
import { evaluatePolicy, policyDocumentSchema } from '../domain/policy'
import { useDatabase } from '../utils/database'
import { xrplRpc } from '../utils/xrpl-rpc'
import { loadSponsorProtocolDefinitions, parseDefinitionsHashAllowlist } from './xrpl/definitions'
import { simulateSponsoredTransaction } from './xrpl/simulate'

const managedFields = new Set(['Account', 'Fee', 'Sequence', 'LastLedgerSequence', 'NetworkID', 'Sponsor', 'SponsorFlags', 'SponsorSignature', 'SigningPubKey', 'TxnSignature', 'Signers'])

export type IntentCreationRequest = {
  account: string
  transaction: Record<string, unknown>
  sponsorship: { fee: boolean, reserve: boolean }
  policyId?: string
  signing: { mode: 'single' | 'multi', signerCount: number }
}

function grantToken(intentId: string, idempotencyKey: string, requestHash: string): string {
  const secret = process.env.ACME_GRANT_SECRET || process.env.BETTER_AUTH_SECRET
  if (!secret || secret.length < 32) throw new Error('ACME_GRANT_SECRET must contain at least 32 characters')
  return `grant_${createHmac('sha256', secret).update(`acme.sponsorship-grant.v1:${intentId}:${idempotencyKey}:${requestHash}`).digest('base64url')}`
}

function grantHash(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function intentCreationResponse(intent: typeof sponsorshipIntents.$inferSelect, token: string) {
  return {
    id: intent.id,
    projectId: intent.projectId,
    state: intent.state,
    network: intent.network,
    networkId: intent.networkId,
    definitionsHash: intent.definitionsHash,
    account: intent.accountAddress,
    transaction: intent.canonicalTransaction,
    canonicalHash: intent.canonicalHash,
    sponsorship: { feeDrops: intent.estimatedFeeDrops.toString(), reserveDrops: intent.estimatedReserveDrops.toString() },
    expiresAt: intent.expiresAt,
    grant: token
  }
}

/**
 * Reconstruct an unconsumed signing package after a client lost the original
 * response. The token is deterministic, so this does not create a second
 * grant or alter the intent's lifecycle.
 */
export async function resumeSponsorshipIntentSigning(projectId: string, intentId: string) {
  const database = useDatabase()
  const [row] = await database.select({ intent: sponsorshipIntents, grant: sponsorshipGrants }).from(sponsorshipIntents)
    .innerJoin(sponsorshipGrants, eq(sponsorshipGrants.intentId, sponsorshipIntents.id))
    .where(and(eq(sponsorshipIntents.id, intentId), eq(sponsorshipIntents.projectId, projectId), eq(sponsorshipGrants.projectId, projectId), eq(sponsorshipGrants.audience, 'xrpl-connect')))
    .limit(1)
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Intent signing package not found' })
  const now = new Date()
  if (row.intent.state !== 'awaiting_user_signature') throw createError({ statusCode: 409, statusMessage: 'Intent is no longer awaiting user signature' })
  if (row.intent.expiresAt <= now || row.grant.expiresAt <= now) throw createError({ statusCode: 410, statusMessage: 'Intent signing package has expired' })
  if (row.grant.consumedAt || row.grant.accountAddress !== row.intent.accountAddress || row.grant.canonicalHash !== row.intent.canonicalHash) {
    throw createError({ statusCode: 409, statusMessage: 'Intent signing package is no longer available' })
  }
  const token = grantToken(row.intent.id, row.intent.idempotencyKey, row.intent.requestHash)
  if (grantHash(token) !== row.grant.tokenHash) throw createError({ statusCode: 409, statusMessage: 'Intent signing package is no longer available' })
  return intentCreationResponse(row.intent, token)
}

export async function createSponsorshipIntent(input: {
  project: typeof projects.$inferSelect
  idempotencyKey: string
  correlationId: string
  actor: string
  request: IntentCreationRequest
}) {
  const requestHash = canonicalHash(input.request)
  const database = useDatabase()
  // Lock the project while resolving idempotent retries. This prevents a
  // deletion that has already archived the project from replaying an old
  // creation response.
  const existing = await database.transaction(async (tx) => {
    const [project] = await tx.select({ id: projects.id, status: projects.status }).from(projects).where(eq(projects.id, input.project.id)).for('update').limit(1)
    if (!project || project.status !== 'active') throw createError({ statusCode: 409, statusMessage: 'Project is no longer active', data: { code: 'PROJECT_ARCHIVED' } })
    const [row] = await tx.select().from(sponsorshipIntents).where(and(eq(sponsorshipIntents.projectId, input.project.id), eq(sponsorshipIntents.idempotencyKey, input.idempotencyKey))).limit(1)
    return row
  })
  if (existing) {
    if (existing.requestHash !== requestHash) throw createError({ statusCode: 409, statusMessage: 'Idempotency key was already used for a different request' })
    return intentCreationResponse(existing, grantToken(existing.id, input.idempotencyKey, requestHash))
  }
  const managedField = Object.keys(input.request.transaction).find(field => managedFields.has(field))
  if (managedField) throw createError({ statusCode: 400, statusMessage: `${managedField} is managed by ACME and must be omitted` })
  if (typeof input.request.transaction.TransactionType !== 'string') throw createError({ statusCode: 400, statusMessage: 'TransactionType is required' })
  const [sponsorBinding] = await database.select({ binding: sponsorAccounts, treasury: sponsorTreasuries }).from(projectSponsorAccounts)
    .innerJoin(sponsorAccounts, eq(sponsorAccounts.id, projectSponsorAccounts.sponsorAccountId))
    .innerJoin(sponsorTreasuries, eq(sponsorTreasuries.id, sponsorAccounts.treasuryId))
    .where(and(eq(projectSponsorAccounts.projectId, input.project.id), eq(projectSponsorAccounts.network, input.project.network), eq(sponsorAccounts.status, 'active'), eq(sponsorTreasuries.status, 'active'))).limit(1)
  if (!sponsorBinding) throw createError({ statusCode: 409, statusMessage: 'No active sponsor account is configured for this project' })
  const sponsor = sponsorBinding.treasury
  const policyWhere = input.request.policyId
    ? and(eq(sponsorshipPolicies.id, input.request.policyId), eq(sponsorshipPolicies.projectId, input.project.id), eq(sponsorshipPolicies.status, 'active'))
    : and(eq(sponsorshipPolicies.projectId, input.project.id), eq(sponsorshipPolicies.status, 'active'))
  const [policyRow] = await database.select().from(sponsorshipPolicies).where(policyWhere).orderBy(desc(sponsorshipPolicies.version)).limit(1)
  if (!policyRow) throw createError({ statusCode: 409, statusMessage: 'No matching active sponsorship policy exists' })
  const policy = policyDocumentSchema.parse(policyRow.document)
  const [protocol, accountInfo, feeResult, serverInfo] = await Promise.all([
    loadSponsorProtocolDefinitions({ rpcUrl: input.project.rpcUrl, allowedHashes: parseDefinitionsHashAllowlist(process.env.ACME_XRPL_DEFINITIONS_HASHES) }),
    xrplRpc<{ account_data: { Sequence: number } }>(input.project.rpcUrl, 'account_info', { account: input.request.account, ledger_index: 'validated', strict: true }),
    xrplRpc<{ drops: { base_fee: string, open_ledger_fee: string } }>(input.project.rpcUrl, 'fee', {}),
    xrplRpc<{ info: { validated_ledger: { seq: number } } }>(input.project.rpcUrl, 'server_info', {})
  ])
  const baseFeeDrops = BigInt(feeResult.drops.base_fee)
  const openLedgerFeeDrops = BigInt(feeResult.drops.open_ledger_fee)
  const signatureUnits = input.request.signing.mode === 'multi' ? BigInt(1 + input.request.signing.signerCount) : 1n
  const feeDrops = openLedgerFeeDrops > baseFeeDrops * signatureUnits ? openLedgerFeeDrops : baseFeeDrops * signatureUnits
  const transaction = {
    ...input.request.transaction,
    Account: input.request.account,
    Fee: feeDrops.toString(),
    Sequence: accountInfo.account_data.Sequence,
    LastLedgerSequence: serverInfo.info.validated_ledger.seq + 20,
    Sponsor: sponsor.address,
    SponsorFlags: (input.request.sponsorship.fee ? protocol.flags.sponsorFee : 0) | (input.request.sponsorship.reserve ? protocol.flags.sponsorReserve : 0)
  }
  const simulation = await simulateSponsoredTransaction({ rpcUrl: input.project.rpcUrl, transaction: transaction as never, sponsorAddress: sponsor.address })
  const reserveDrops = input.request.sponsorship.reserve ? simulation.reserveDrops : 0n
  const decision = evaluatePolicy({ policy, transaction: { ...input.request.transaction, Account: input.request.account }, account: input.request.account, feeDrops, reserveDrops })
  if (!decision.allowed) throw createError({ statusCode: 403, statusMessage: decision.code, data: { reason: decision.reason } })
  const startOfDay = new Date()
  startOfDay.setUTCHours(0, 0, 0, 0)
  const [dailyUsage] = await database.select({ value: count() }).from(sponsorshipIntents).where(and(eq(sponsorshipIntents.projectId, input.project.id), eq(sponsorshipIntents.accountAddress, input.request.account), gte(sponsorshipIntents.createdAt, startOfDay)))
  if ((dailyUsage?.value || 0) >= policy.maximumIntentsPerWalletPerDay) throw createError({ statusCode: 429, statusMessage: 'Wallet sponsorship rate limit exceeded' })
  const intentId = randomUUID()
  const expiresAt = new Date(Date.now() + policy.intentTtlSeconds * 1000)
  const transactionHash = canonicalHash(transaction)
  const token = grantToken(intentId, input.idempotencyKey, requestHash)
  const intent = await database.transaction(async (tx) => {
    const [project] = await tx.select({ id: projects.id, status: projects.status }).from(projects).where(eq(projects.id, input.project.id)).for('update').limit(1)
    if (!project || project.status !== 'active') throw createError({ statusCode: 409, statusMessage: 'Project is no longer active', data: { code: 'PROJECT_ARCHIVED' } })
    const [created] = await tx.insert(sponsorshipIntents).values({
      id: intentId, projectId: input.project.id, sponsorAccountId: sponsorBinding.binding.id, policyId: policyRow.id,
      accountAddress: input.request.account, network: input.project.network, networkId: protocol.networkId,
      definitionsHash: protocol.definitionsHash, mode: input.request.sponsorship.fee && input.request.sponsorship.reserve ? 'fee_and_reserve' : input.request.sponsorship.reserve ? 'reserve' : 'fee',
      canonicalTransaction: transaction, canonicalHash: transactionHash, preparedLedgerIndex: serverInfo.info.validated_ledger.seq,
      requestHash, policySnapshot: policyRow.document, estimatedFeeDrops: feeDrops, estimatedReserveDrops: reserveDrops,
      idempotencyKey: input.idempotencyKey, correlationId: input.correlationId, state: 'awaiting_user_signature', expiresAt
    }).returning()
    if (!created) throw new Error('Intent creation failed')
    await tx.insert(sponsorshipGrants).values({ projectId: input.project.id, intentId: created.id, tokenHash: grantHash(token), audience: 'xrpl-connect', accountAddress: input.request.account, canonicalHash: transactionHash, expiresAt })
    await tx.insert(intentEvents).values({ intentId: created.id, version: 1, fromState: null, toState: 'awaiting_user_signature', actor: input.actor })
    return created
  })
  return intentCreationResponse(intent, token)
}
