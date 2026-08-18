import { randomUUID } from 'node:crypto'
import { and, asc, eq, isNull, lt, lte, max, or, sql } from 'drizzle-orm'
import {
  fundingBalances,
  fundingLedgerEntries,
  intentEvents,
  outboxEvents,
  platformControls,
  projects,
  reserveMigrationTargets,
  reserveMigrationPlans,
  reserveObligations,
  sponsorAccounts,
  sponsorshipIntents,
  submissions,
  usageEvents,
  workerHeartbeats
} from '../database/schema'
import { loadSponsorProtocolDefinitions } from './xrpl/definitions'
import { inspectReserveTargets } from './reserve-inspection'
import { useDatabase } from '../utils/database'
import { XrplRpcError, xrplRpc } from '../utils/xrpl-rpc'

const WORKER_NAME = 'xrpl-intent-worker'
const LEASE_MS = 30_000
const MAX_SUBMIT_ATTEMPTS = 12

class SponsorshipPausedError extends Error {
  constructor() {
    super('Sponsorship is paused; submission is deferred')
    this.name = 'SponsorshipPausedError'
  }
}

type OutboxEvent = typeof outboxEvents.$inferSelect
type Intent = typeof sponsorshipIntents.$inferSelect
type XrplMetadata = {
  TransactionResult?: string
  AffectedNodes?: Array<{
    CreatedNode?: LedgerNode
    ModifiedNode?: LedgerNode & { PreviousFields?: Record<string, unknown> }
  }>
}
type LedgerNode = {
  LedgerEntryType?: string
  LedgerIndex?: string
  NewFields?: Record<string, unknown>
  FinalFields?: Record<string, unknown>
}
type ValidatedTransaction = {
  validated?: boolean
  ledger_index?: number
  meta?: XrplMetadata | string
  tx_json?: Record<string, unknown>
  Fee?: string
}

function nextAttemptAt(attempts: number): Date {
  const delay = Math.min(60_000, 500 * 2 ** Math.min(attempts, 7))
  return new Date(Date.now() + delay + Math.floor(Math.random() * 250))
}

function isSubmitAccepted(result: string): boolean {
  return result.startsWith('tes') || result.startsWith('tec') || result === 'terQUEUED' || result === 'tefALREADY'
}

function reserveTargets(meta: XrplMetadata, intent: Intent, sponsorAddress: string) {
  const targets: Array<{ objectId: string, objectType: string, trustlineSide: string | null }> = []
  for (const wrapper of meta.AffectedNodes || []) {
    const node = wrapper.CreatedNode || wrapper.ModifiedNode
    if (!node?.LedgerEntryType || !node.LedgerIndex) continue
    const fields = node.NewFields || node.FinalFields || {}
    const previous = wrapper.ModifiedNode?.PreviousFields || {}
    const sponsored = fields.Sponsor === sponsorAddress && previous.Sponsor !== sponsorAddress
    const highSponsored = fields.HighSponsor === sponsorAddress && previous.HighSponsor !== sponsorAddress
    const lowSponsored = fields.LowSponsor === sponsorAddress && previous.LowSponsor !== sponsorAddress
    if (sponsored) targets.push({ objectId: node.LedgerIndex, objectType: node.LedgerEntryType, trustlineSide: null })
    if (highSponsored) targets.push({ objectId: node.LedgerIndex, objectType: node.LedgerEntryType, trustlineSide: 'high' })
    if (lowSponsored) targets.push({ objectId: node.LedgerIndex, objectType: node.LedgerEntryType, trustlineSide: 'low' })
  }
  if (!targets.length && intent.estimatedReserveDrops > 0n) {
    const transaction = intent.canonicalTransaction
    targets.push({
      objectId: typeof transaction.ObjectID === 'string' ? transaction.ObjectID : intent.accountAddress,
      objectType: typeof transaction.ObjectID === 'string' ? 'Unknown' : 'AccountRoot',
      trustlineSide: null
    })
  }
  return targets
}

async function eventVersion(tx: Parameters<Parameters<ReturnType<typeof useDatabase>['transaction']>[0]>[0], intentId: string) {
  const [row] = await tx.select({ value: max(intentEvents.version) }).from(intentEvents).where(eq(intentEvents.intentId, intentId))
  return Number(row?.value || 0) + 1
}

async function releaseReservation(tx: Parameters<Parameters<ReturnType<typeof useDatabase>['transaction']>[0]>[0], intent: Intent, sponsorAccountId: string, reason: string) {
  const [balance] = await tx.select().from(fundingBalances).where(eq(fundingBalances.sponsorAccountId, sponsorAccountId)).for('update').limit(1)
  if (!balance) return
  await tx.update(fundingBalances).set({
    pendingFeeDrops: balance.pendingFeeDrops > intent.estimatedFeeDrops ? balance.pendingFeeDrops - intent.estimatedFeeDrops : 0n,
    pendingReserveDrops: balance.pendingReserveDrops > intent.estimatedReserveDrops ? balance.pendingReserveDrops - intent.estimatedReserveDrops : 0n,
    version: balance.version + 1,
    updatedAt: new Date()
  }).where(eq(fundingBalances.sponsorAccountId, sponsorAccountId))
  await tx.insert(fundingLedgerEntries).values({
    sponsorAccountId,
    intentId: intent.id,
    type: 'release',
    feeDrops: intent.estimatedFeeDrops,
    reserveDrops: intent.estimatedReserveDrops,
    idempotencyKey: `intent:${intent.id}:release`,
    reason
  }).onConflictDoNothing()
}

async function markTerminalFailure(intentId: string, reason: string, state: 'failed' | 'expired' = 'failed') {
  const database = useDatabase()
  await database.transaction(async (tx) => {
    const [intent] = await tx.select().from(sponsorshipIntents).where(eq(sponsorshipIntents.id, intentId)).for('update').limit(1)
    if (!intent || ['validated', 'failed', 'expired', 'rejected', 'cancelled', 'superseded'].includes(intent.state)) return
    if (!intent.sponsorAccountId) throw new Error('Intent has no sponsor account')
    await releaseReservation(tx, intent, intent.sponsorAccountId, reason)
    const version = await eventVersion(tx, intent.id)
    await tx.update(sponsorshipIntents).set({ state, updatedAt: new Date() }).where(eq(sponsorshipIntents.id, intent.id))
    await tx.update(reserveMigrationTargets).set({ state, errorCode: reason.slice(0, 255), updatedAt: new Date() }).where(eq(reserveMigrationTargets.intentId, intent.id))
    await tx.insert(intentEvents).values({ intentId: intent.id, version, fromState: intent.state, toState: state, actor: `worker:${WORKER_NAME}`, reason })
  })
}

async function finalizeValidated(intentId: string, transaction: ValidatedTransaction) {
  const metadata = typeof transaction.meta === 'object' ? transaction.meta : {}
  const result = metadata.TransactionResult || 'unknown'
  const successful = result === 'tesSUCCESS'
  const ledgerIndex = Number(transaction.ledger_index)
  const actualFeeDrops = BigInt(String(transaction.tx_json?.Fee || transaction.Fee || '0'))
  const database = useDatabase()
  await database.transaction(async (tx) => {
    const [context] = await tx.select({ intent: sponsorshipIntents, sponsor: sponsorAccounts })
      .from(sponsorshipIntents)
      .innerJoin(sponsorAccounts, eq(sponsorAccounts.id, sponsorshipIntents.sponsorAccountId))
      .where(eq(sponsorshipIntents.id, intentId)).for('update').limit(1)
    if (!context || ['validated', 'failed', 'expired'].includes(context.intent.state)) return
    const [balance] = await tx.select().from(fundingBalances).where(eq(fundingBalances.sponsorAccountId, context.sponsor.id)).for('update').limit(1)
    if (!balance) throw new Error('Sponsor funding balance is unavailable')
    await tx.update(fundingBalances).set({
      pendingFeeDrops: balance.pendingFeeDrops > context.intent.estimatedFeeDrops ? balance.pendingFeeDrops - context.intent.estimatedFeeDrops : 0n,
      pendingReserveDrops: balance.pendingReserveDrops > context.intent.estimatedReserveDrops ? balance.pendingReserveDrops - context.intent.estimatedReserveDrops : 0n,
      capturedFeeDrops: balance.capturedFeeDrops + actualFeeDrops,
      lockedReserveDrops: balance.lockedReserveDrops + (successful ? context.intent.estimatedReserveDrops : 0n),
      version: balance.version + 1,
      updatedAt: new Date()
    }).where(eq(fundingBalances.sponsorAccountId, context.sponsor.id))
    await tx.insert(fundingLedgerEntries).values({
      sponsorAccountId: context.sponsor.id,
      intentId,
      type: 'capture',
      feeDrops: actualFeeDrops,
      reserveDrops: successful ? context.intent.estimatedReserveDrops : 0n,
      idempotencyKey: `intent:${intentId}:capture`,
      reason: result
    }).onConflictDoNothing()
    if (!successful && context.intent.estimatedReserveDrops > 0n) {
      await tx.insert(fundingLedgerEntries).values({
        sponsorAccountId: context.sponsor.id,
        intentId,
        type: 'release',
        reserveDrops: context.intent.estimatedReserveDrops,
        idempotencyKey: `intent:${intentId}:reserve-release`,
        reason: result
      }).onConflictDoNothing()
    }
    await tx.insert(usageEvents).values({ projectId: context.intent.projectId, intentId, chargeType: 'fee', feeDrops: actualFeeDrops }).onConflictDoNothing()
    if (successful && context.intent.estimatedReserveDrops > 0n) {
      await tx.insert(usageEvents).values({ projectId: context.intent.projectId, intentId, chargeType: 'reserve', reserveDrops: context.intent.estimatedReserveDrops }).onConflictDoNothing()
      const targets = reserveTargets(metadata, context.intent, context.sponsor.address)
      const perTarget = context.intent.estimatedReserveDrops / BigInt(targets.length || 1)
      for (const [index, target] of targets.entries()) {
        const remainder = index === targets.length - 1 ? context.intent.estimatedReserveDrops - perTarget * BigInt(index) : perTarget
        await tx.insert(reserveObligations).values({
          sponsorAccountId: context.sponsor.id,
          intentId,
          ownerAddress: context.intent.accountAddress,
          objectId: target.objectId,
          objectType: target.objectType,
          trustlineSide: target.trustlineSide,
          reserveDrops: remainder,
          state: 'active',
          activatedLedgerIndex: ledgerIndex
        }).onConflictDoNothing()
      }
    }
    const nextState = successful ? 'validated' : 'failed'
    const version = await eventVersion(tx, intentId)
    await tx.update(sponsorshipIntents).set({ state: nextState, updatedAt: new Date() }).where(eq(sponsorshipIntents.id, intentId))
    await tx.update(reserveMigrationTargets).set({ state: nextState, errorCode: successful ? null : result, updatedAt: new Date() }).where(eq(reserveMigrationTargets.intentId, intentId))
    await tx.update(submissions).set({ ledgerIndex, actualFeeDrops, validatedAt: new Date() }).where(eq(submissions.intentId, intentId))
    await tx.insert(intentEvents).values({ intentId, version, fromState: context.intent.state, toState: nextState, actor: `worker:${WORKER_NAME}`, reason: result })
  })
}

async function ensureReconciliationEvent(intentId: string) {
  await useDatabase().insert(outboxEvents).values({
    aggregateType: 'sponsorship_intent',
    aggregateId: intentId,
    eventType: 'xrpl.reconcile',
    payload: { intentId }
  }).onConflictDoNothing()
}

async function verifyMigrationLedgerState(intentId: string, rpcUrl: string, transaction: ValidatedTransaction) {
  const metadata = typeof transaction.meta === 'object' ? transaction.meta : undefined
  if (metadata?.TransactionResult !== 'tesSUCCESS') return
  const [migration] = await useDatabase().select({ target: reserveMigrationTargets, plan: reserveMigrationPlans, sponsor: sponsorAccounts })
    .from(reserveMigrationTargets)
    .innerJoin(reserveMigrationPlans, eq(reserveMigrationPlans.id, reserveMigrationTargets.planId))
    .innerJoin(sponsorAccounts, eq(sponsorAccounts.id, reserveMigrationPlans.sponsorAccountId))
    .where(eq(reserveMigrationTargets.intentId, intentId)).limit(1)
  if (!migration) return
  const inspection = await inspectReserveTargets({ rpcUrl, account: migration.plan.accountAddress })
  const target = inspection.targets.find(item => item.targetKey === migration.target.targetKey)
  if (!target || target.observedSponsor !== migration.sponsor.address) {
    throw new Error('Validated transfer is not yet reflected in the target ledger object')
  }
}

async function processSubmit(event: OutboxEvent) {
  const database = useDatabase()
  const [context] = await database.select({ intent: sponsorshipIntents, project: projects, sponsor: sponsorAccounts, submission: submissions })
    .from(sponsorshipIntents)
    .innerJoin(projects, eq(projects.id, sponsorshipIntents.projectId))
    .innerJoin(sponsorAccounts, eq(sponsorAccounts.id, sponsorshipIntents.sponsorAccountId))
    .innerJoin(submissions, and(eq(submissions.intentId, sponsorshipIntents.id), eq(submissions.attempt, 1)))
    .where(eq(sponsorshipIntents.id, event.aggregateId)).limit(1)
  if (!context) throw new Error('Outbox submission context does not exist')
  const [control] = await database.select().from(platformControls).where(eq(platformControls.key, 'sponsorship')).limit(1)
  if (control?.paused || context.project.status !== 'active' || context.sponsor.status !== 'active') throw new SponsorshipPausedError()
  await loadSponsorProtocolDefinitions({ rpcUrl: context.project.rpcUrl, allowedHashes: [context.intent.definitionsHash], forceRefresh: true })
  try {
    const existing = await xrplRpc<ValidatedTransaction>(context.project.rpcUrl, 'tx', { transaction: context.submission.transactionHash, binary: false }, { retries: 0 })
    if (existing.validated) {
      await verifyMigrationLedgerState(context.intent.id, context.project.rpcUrl, existing)
      await finalizeValidated(context.intent.id, existing)
      return
    }
  } catch (error) {
    if (!(error instanceof XrplRpcError) || error.code !== 'txnNotFound') throw error
  }
  const result = await xrplRpc<{ engine_result: string, engine_result_message?: string }>(context.project.rpcUrl, 'submit', { tx_blob: context.submission.signedBlob, fail_hard: false }, { retries: 0 })
  await database.update(submissions).set({ engineResult: result.engine_result, response: result }).where(eq(submissions.id, context.submission.id))
  if (!isSubmitAccepted(result.engine_result)) {
    if (!result.engine_result.startsWith('tem')) throw new Error(`${result.engine_result}: ${result.engine_result_message || 'ambiguous or retryable XRPL result'}`)
    await markTerminalFailure(context.intent.id, result.engine_result_message || result.engine_result)
    return
  }
  if (context.intent.state === 'submitting') {
    await database.transaction(async (tx) => {
      const version = await eventVersion(tx, context.intent.id)
      await tx.update(sponsorshipIntents).set({ state: 'submitted', updatedAt: new Date() }).where(and(eq(sponsorshipIntents.id, context.intent.id), eq(sponsorshipIntents.state, 'submitting')))
      await tx.insert(intentEvents).values({ intentId: context.intent.id, version, fromState: 'submitting', toState: 'submitted', actor: `worker:${WORKER_NAME}`, reason: result.engine_result }).onConflictDoNothing()
    })
  }
  await ensureReconciliationEvent(context.intent.id)
}

async function processReconcile(event: OutboxEvent) {
  const database = useDatabase()
  const [context] = await database.select({ intent: sponsorshipIntents, project: projects, submission: submissions })
    .from(sponsorshipIntents)
    .innerJoin(projects, eq(projects.id, sponsorshipIntents.projectId))
    .innerJoin(submissions, and(eq(submissions.intentId, sponsorshipIntents.id), eq(submissions.attempt, 1)))
    .where(eq(sponsorshipIntents.id, event.aggregateId)).limit(1)
  if (!context || ['validated', 'failed', 'expired'].includes(context?.intent.state || '')) return
  try {
    const transaction = await xrplRpc<ValidatedTransaction>(context.project.rpcUrl, 'tx', {
      transaction: context.submission.transactionHash,
      binary: false,
      min_ledger: context.submission.firstSubmittedLedgerIndex,
      max_ledger: Number(context.intent.canonicalTransaction.LastLedgerSequence)
    }, { retries: 0 })
    if (transaction.validated) {
      await verifyMigrationLedgerState(context.intent.id, context.project.rpcUrl, transaction)
      await finalizeValidated(context.intent.id, transaction)
      return
    }
  } catch (error) {
    if (!(error instanceof XrplRpcError) || error.code !== 'txnNotFound') throw error
    if (error.data?.searched_all === true) {
      await markTerminalFailure(context.intent.id, 'Transaction was absent from the complete validated ledger range', 'expired')
      return
    }
  }
  throw new Error('Transaction is not validated yet')
}

async function claimNext(instanceId: string): Promise<OutboxEvent | undefined> {
  const database = useDatabase()
  const leaseExpired = new Date(Date.now() - LEASE_MS)
  return database.transaction(async (tx) => {
    const [event] = await tx.select().from(outboxEvents).where(and(
      isNull(outboxEvents.processedAt),
      isNull(outboxEvents.deadLetteredAt),
      lte(outboxEvents.availableAt, new Date()),
      or(isNull(outboxEvents.lockedAt), lt(outboxEvents.lockedAt, leaseExpired))
    )).orderBy(asc(outboxEvents.availableAt)).for('update', { skipLocked: true }).limit(1)
    if (!event) return undefined
    const [claimed] = await tx.update(outboxEvents).set({ lockedAt: new Date(), lockedBy: instanceId, lockVersion: event.lockVersion + 1 }).where(eq(outboxEvents.id, event.id)).returning()
    return claimed
  })
}

async function markProcessed(event: OutboxEvent) {
  await useDatabase().update(outboxEvents).set({ processedAt: new Date(), lockedAt: null, lockedBy: null, lastError: null }).where(and(eq(outboxEvents.id, event.id), eq(outboxEvents.lockedBy, event.lockedBy!), eq(outboxEvents.lockVersion, event.lockVersion)))
}

async function markRetry(event: OutboxEvent, error: unknown) {
  if (error instanceof SponsorshipPausedError) {
    await useDatabase().update(outboxEvents).set({
      availableAt: new Date(Date.now() + 5_000),
      lockedAt: null,
      lockedBy: null,
      lastError: error.message
    }).where(and(eq(outboxEvents.id, event.id), eq(outboxEvents.lockedBy, event.lockedBy!), eq(outboxEvents.lockVersion, event.lockVersion)))
    return
  }
  const attempts = event.attempts + 1
  const message = error instanceof Error ? error.message.slice(0, 2_000) : 'Unknown worker failure'
  if (event.eventType === 'xrpl.submit' && attempts >= MAX_SUBMIT_ATTEMPTS) {
    await useDatabase().update(outboxEvents).set({ deadLetteredAt: new Date(), lockedAt: null, lockedBy: null, lastError: message }).where(and(eq(outboxEvents.id, event.id), eq(outboxEvents.lockedBy, event.lockedBy!), eq(outboxEvents.lockVersion, event.lockVersion)))
    return
  }
  await useDatabase().update(outboxEvents).set({
    attempts: sql`${outboxEvents.attempts} + 1`,
    availableAt: nextAttemptAt(attempts),
    lockedAt: null,
    lockedBy: null,
    lastError: message
  }).where(and(eq(outboxEvents.id, event.id), eq(outboxEvents.lockedBy, event.lockedBy!), eq(outboxEvents.lockVersion, event.lockVersion)))
}

export async function processOneIntentEvent(instanceId: string): Promise<boolean> {
  const event = await claimNext(instanceId)
  if (!event) return false
  try {
    if (event.eventType === 'xrpl.submit') await processSubmit(event)
    else if (event.eventType === 'xrpl.reconcile') await processReconcile(event)
    else throw new Error(`Unsupported outbox event: ${event.eventType}`)
    await markProcessed(event)
  } catch (error) {
    await markRetry(event, error)
  }
  return true
}

export async function recordWorkerHeartbeat(instanceId: string, status: 'running' | 'stopping', metadata: Record<string, unknown> = {}) {
  await useDatabase().insert(workerHeartbeats).values({ workerName: WORKER_NAME, instanceId, status, metadata, lastHeartbeatAt: new Date() }).onConflictDoUpdate({
    target: workerHeartbeats.workerName,
    set: { instanceId, status, metadata, lastHeartbeatAt: new Date() }
  })
}

export async function reconcileOneReserveObligation(): Promise<boolean> {
  const database = useDatabase()
  const [context] = await database.select({ obligation: reserveObligations, sponsor: sponsorAccounts, project: projects })
    .from(reserveObligations)
    .innerJoin(sponsorAccounts, eq(sponsorAccounts.id, reserveObligations.sponsorAccountId))
    .innerJoin(projects, eq(projects.id, sponsorAccounts.projectId))
    .where(eq(reserveObligations.state, 'active'))
    .orderBy(asc(reserveObligations.updatedAt))
    .limit(1)
  if (!context) return false
  let currentSponsor: string | undefined
  let ledgerIndex = 0
  try {
    if (context.obligation.objectType === 'AccountRoot') {
      const result = await xrplRpc<{ account_data: { Sponsor?: string }, ledger_index: number }>(context.project.rpcUrl, 'account_info', { account: context.obligation.ownerAddress, ledger_index: 'validated', strict: true })
      currentSponsor = result.account_data.Sponsor
      ledgerIndex = result.ledger_index
    } else {
      const result = await xrplRpc<{ node: Record<string, unknown>, ledger_index: number }>(context.project.rpcUrl, 'ledger_entry', { index: context.obligation.objectId, ledger_index: 'validated' })
      currentSponsor = context.obligation.trustlineSide === 'high'
        ? String(result.node.HighSponsor || '') || undefined
        : context.obligation.trustlineSide === 'low'
          ? String(result.node.LowSponsor || '') || undefined
          : String(result.node.Sponsor || '') || undefined
      ledgerIndex = result.ledger_index
    }
  } catch (error) {
    const absent = error instanceof XrplRpcError && ['actNotFound', 'entryNotFound'].includes(error.code || '')
    if (!absent) throw error
  }
  if (currentSponsor === context.sponsor.address) {
    await database.update(reserveObligations).set({ updatedAt: new Date() }).where(eq(reserveObligations.id, context.obligation.id))
    return true
  }
  await database.transaction(async (tx) => {
    const [obligation] = await tx.select().from(reserveObligations).where(eq(reserveObligations.id, context.obligation.id)).for('update').limit(1)
    if (!obligation || obligation.state !== 'active') return
    const [balance] = await tx.select().from(fundingBalances).where(eq(fundingBalances.sponsorAccountId, obligation.sponsorAccountId)).for('update').limit(1)
    if (!balance) throw new Error('Sponsor funding balance is unavailable')
    await tx.insert(fundingLedgerEntries).values({
      sponsorAccountId: obligation.sponsorAccountId,
      intentId: obligation.intentId,
      type: 'release',
      reserveDrops: obligation.reserveDrops,
      idempotencyKey: `obligation:${obligation.id}:release`,
      reason: 'Validated ledger no longer names this sponsor'
    }).onConflictDoNothing()
    await tx.update(fundingBalances).set({
      lockedReserveDrops: balance.lockedReserveDrops > obligation.reserveDrops ? balance.lockedReserveDrops - obligation.reserveDrops : 0n,
      version: balance.version + 1,
      updatedAt: new Date()
    }).where(eq(fundingBalances.sponsorAccountId, obligation.sponsorAccountId))
    await tx.update(reserveObligations).set({ state: 'released', releasedLedgerIndex: ledgerIndex || null, updatedAt: new Date() }).where(eq(reserveObligations.id, obligation.id))
    await tx.update(reserveMigrationTargets).set({ state: 'released', updatedAt: new Date() }).where(eq(reserveMigrationTargets.intentId, obligation.intentId))
  })
  return true
}

export function createWorkerInstanceId() {
  return `${process.pid}-${randomUUID()}`
}
