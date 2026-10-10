import { createHash, timingSafeEqual } from 'node:crypto'
import { and, eq, gt, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { fundingBalances, fundingLedgerEntries, intentEvents, organizations, outboxEvents, platformControls, projects, reserveMigrationPlans, reserveMigrationTargets, sponsorAccounts, sponsorTreasuries, sponsorshipGrants, sponsorshipIntents, sponsorshipPolicies, submissions } from '~~/server/database/schema'
import { canonicalHash } from '~~/server/domain/canonical-json'
import { evaluatePolicy, policyDocumentSchema } from '~~/server/domain/policy'
import { createSponsorSigner } from '~~/server/services/signer/factory'
import { FundingCapacityError, reserveFundingCapacity } from '~~/server/services/funding'
import type { XrplTransaction } from '~~/server/services/signer/types'
import { inspectReserveTargets } from '~~/server/services/reserve-inspection'
import { verifySponseeLedgerAuthorization } from '~~/server/services/xrpl/authorization'
import { useDatabase } from '~~/server/utils/database'
import { xrplRpc } from '~~/server/utils/xrpl-rpc'

const bodySchema = z.object({ grant: z.string().min(32).max(256), signedTransaction: z.string().regex(/^[A-Fa-f0-9]+$/).max(262144) })

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

function hashesEqual(actual: string, expected: string) {
  const left = Buffer.from(actual, 'hex')
  const right = Buffer.from(expected, 'hex')
  return left.length === right.length && timingSafeEqual(left, right)
}

function unsignedEnvelope(transaction: XrplTransaction) {
  const copy = { ...transaction }
  delete copy.SigningPubKey
  delete copy.TxnSignature
  delete copy.Signers
  delete copy.SponsorSignature
  return copy
}

export default defineEventHandler(async (event) => {
  const intentId = getRouterParam(event, 'intentId')
  if (!intentId) throw createError({ statusCode: 400, statusMessage: 'Intent ID is required' })
  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Invalid authorization request', data: parsed.error.flatten() })
  const database = useDatabase()
  const [context] = await database.select({ intent: sponsorshipIntents, project: projects, organization: organizations, sponsor: sponsorAccounts, treasury: sponsorTreasuries, policy: sponsorshipPolicies }).from(sponsorshipIntents)
    .innerJoin(projects, eq(projects.id, sponsorshipIntents.projectId))
    .innerJoin(organizations, eq(organizations.id, projects.organizationId))
    .innerJoin(sponsorAccounts, eq(sponsorAccounts.id, sponsorshipIntents.sponsorAccountId))
    .innerJoin(sponsorTreasuries, eq(sponsorTreasuries.id, sponsorAccounts.treasuryId))
    .innerJoin(sponsorshipPolicies, eq(sponsorshipPolicies.id, sponsorshipIntents.policyId))
    .where(eq(sponsorshipIntents.id, intentId)).limit(1)
  if (!context) throw createError({ statusCode: 404, statusMessage: 'Intent not found' })
  if (['submitting', 'submitted', 'validated'].includes(context.intent.state)) {
    const tokenHash = hashToken(parsed.data.grant)
    const [existingGrant] = await database.select({ tokenHash: sponsorshipGrants.tokenHash }).from(sponsorshipGrants).where(and(
      eq(sponsorshipGrants.intentId, intentId),
      eq(sponsorshipGrants.projectId, context.intent.projectId),
      eq(sponsorshipGrants.accountAddress, context.intent.accountAddress),
      eq(sponsorshipGrants.canonicalHash, context.intent.canonicalHash),
      eq(sponsorshipGrants.audience, 'xrpl-connect')
    )).limit(1)
    if (!existingGrant || !hashesEqual(tokenHash, existingGrant.tokenHash)) throw createError({ statusCode: 403, statusMessage: 'Grant is invalid or does not authorize this intent' })
    const existingBlob = context.intent.userSignedBlob?.toUpperCase()
    if (!existingBlob || existingBlob !== parsed.data.signedTransaction.toUpperCase()) throw createError({ statusCode: 409, statusMessage: 'Intent was already authorized with a different signed transaction' })
    const [submission] = await database.select({ transactionHash: submissions.transactionHash }).from(submissions).where(and(eq(submissions.intentId, intentId), eq(submissions.attempt, 1))).limit(1)
    if (!submission) throw createError({ statusCode: 409, statusMessage: 'Intent authorization is still being finalized; retry with the exact signed transaction' })
    setResponseStatus(event, 202)
    return { intentId, state: context.intent.state, transactionHash: submission.transactionHash, engineResult: null }
  }
  if (['failed', 'rejected', 'expired', 'cancelled', 'superseded'].includes(context.intent.state)) throw createError({ statusCode: 409, statusMessage: 'Intent is no longer authorizable' })
  if (context.organization.status !== 'active' || context.project.status !== 'active' || context.sponsor.status !== 'active' || context.treasury.status !== 'active' || context.policy.status !== 'active') throw createError({ statusCode: 409, statusMessage: 'Sponsorship is paused for this project' })
  const tokenHash = hashToken(parsed.data.grant)
  const [preflightControl, preflightGrant] = await Promise.all([
    database.select().from(platformControls).where(eq(platformControls.key, 'sponsorship')).limit(1).then(rows => rows[0]),
    database.select().from(sponsorshipGrants).where(and(eq(sponsorshipGrants.intentId, intentId), isNull(sponsorshipGrants.consumedAt), gt(sponsorshipGrants.expiresAt, new Date()))).limit(1).then(rows => rows[0])
  ])
  if (preflightControl?.paused) throw createError({ statusCode: 503, statusMessage: 'Sponsorship is globally paused' })
  if (!preflightGrant || !hashesEqual(tokenHash, preflightGrant.tokenHash)) throw createError({ statusCode: 403, statusMessage: 'Grant is invalid, expired, or already consumed' })

  const { signer, adapter, protocol } = await createSponsorSigner({ rpcUrl: context.project.rpcUrl, network: context.project.network, expectedDefinitionsHash: context.intent.definitionsHash })
  const signedTransaction = adapter.decode(parsed.data.signedTransaction)
  if (canonicalHash(unsignedEnvelope(signedTransaction)) !== canonicalHash(unsignedEnvelope(context.intent.canonicalTransaction as XrplTransaction))) {
    throw createError({ statusCode: 400, statusMessage: 'Signed transaction does not match the approved intent' })
  }
  await verifySponseeLedgerAuthorization({ rpcUrl: context.project.rpcUrl, transaction: signedTransaction, definitions: protocol.definitions })
  const policyDecision = evaluatePolicy({
    policy: policyDocumentSchema.parse(context.intent.policySnapshot),
    transaction: unsignedEnvelope(signedTransaction),
    account: context.intent.accountAddress,
    feeDrops: context.intent.estimatedFeeDrops,
    reserveDrops: context.intent.estimatedReserveDrops
  })
  if (!policyDecision.allowed) throw createError({ statusCode: 403, statusMessage: policyDecision.code, data: { reason: policyDecision.reason } })
  const [migrationTarget] = await database.select({ target: reserveMigrationTargets, plan: reserveMigrationPlans })
    .from(reserveMigrationTargets)
    .innerJoin(reserveMigrationPlans, eq(reserveMigrationPlans.id, reserveMigrationTargets.planId))
    .where(eq(reserveMigrationTargets.intentId, intentId)).limit(1)
  if (migrationTarget) {
    const inspection = await inspectReserveTargets({ rpcUrl: context.project.rpcUrl, account: migrationTarget.plan.accountAddress })
    const freshTarget = inspection.targets.find(target => target.targetKey === migrationTarget.target.targetKey)
    if (!freshTarget || freshTarget.snapshotHash !== migrationTarget.target.snapshotHash || freshTarget.classification !== 'eligible') {
      throw createError({ statusCode: 409, statusMessage: 'The reserve target changed after intent preparation' })
    }
  }
  const [ledger, accountInfo, sponsorInfo, serverState] = await Promise.all([
    xrplRpc<{ info: { validated_ledger: { seq: number } } }>(context.project.rpcUrl, 'server_info', {}),
    xrplRpc<{ account_data: { Sequence: number } }>(context.project.rpcUrl, 'account_info', { account: context.intent.accountAddress, ledger_index: 'validated', strict: true }),
    xrplRpc<{ account_data: { Balance: string, OwnerCount?: number, SponsoredOwnerCount?: number, SponsoringOwnerCount?: number, SponsoringAccountCount?: number, Sponsor?: string } }>(context.project.rpcUrl, 'account_info', { account: context.sponsor.address, ledger_index: 'validated', strict: true }),
    xrplRpc<{ state: { validated_ledger: { reserve_base: string | number, reserve_inc: string | number } } }>(context.project.rpcUrl, 'server_state', {})
  ])
  if (ledger.info.validated_ledger.seq >= Number(signedTransaction.LastLedgerSequence) - 1) throw createError({ statusCode: 409, statusMessage: 'Intent is too close to its ledger deadline; create a new intent' })
  if (accountInfo.account_data.Sequence !== Number(signedTransaction.Sequence)) throw createError({ statusCode: 409, statusMessage: 'Account sequence changed; create a new intent' })
  const accountReserveDrops = BigInt(serverState.state.validated_ledger.reserve_base)
  const objectReserveDrops = BigInt(serverState.state.validated_ledger.reserve_inc)
  const sponsorData = sponsorInfo.account_data
  const sponsoredObjects = BigInt(Math.max(0, (sponsorData.OwnerCount || 0) + (sponsorData.SponsoringOwnerCount || 0) - (sponsorData.SponsoredOwnerCount || 0)))
  const sponsoredAccounts = BigInt(sponsorData.SponsoringAccountCount || 0)
  const currentReserveDrops = (sponsorData.Sponsor ? 0n : accountReserveDrops) + objectReserveDrops * sponsoredObjects + accountReserveDrops * sponsoredAccounts
  const observedBalanceDrops = BigInt(sponsorData.Balance)
  const liveSpendableDrops = observedBalanceDrops > currentReserveDrops ? observedBalanceDrops - currentReserveDrops : 0n

  const now = new Date()
  const signed = await database.transaction(async (tx) => {
    const [lockedIntent] = await tx.select().from(sponsorshipIntents).where(eq(sponsorshipIntents.id, intentId)).for('update').limit(1)
    if (!lockedIntent) throw createError({ statusCode: 409, statusMessage: 'Intent is no longer authorizable' })
    if (lockedIntent.state !== 'awaiting_user_signature') {
      const [existingSubmission] = await tx.select({ transactionHash: submissions.transactionHash }).from(submissions).where(and(eq(submissions.intentId, intentId), eq(submissions.attempt, 1))).limit(1)
      if (['submitting', 'submitted', 'validated'].includes(lockedIntent.state) && lockedIntent.userSignedBlob?.toUpperCase() === parsed.data.signedTransaction.toUpperCase() && existingSubmission) return { replay: true as const, state: lockedIntent.state, transactionHash: existingSubmission.transactionHash }
      throw createError({ statusCode: 409, statusMessage: 'Intent is no longer authorizable' })
    }
    if (lockedIntent.expiresAt <= now) throw createError({ statusCode: 409, statusMessage: 'Intent is no longer authorizable' })
    const [lockedProject] = await tx.select().from(projects).where(eq(projects.id, lockedIntent.projectId)).for('update').limit(1)
    const [lockedOrganization] = lockedProject ? await tx.select().from(organizations).where(eq(organizations.id, lockedProject.organizationId)).for('update').limit(1) : []
    const [lockedSponsor] = await tx.select().from(sponsorAccounts).where(eq(sponsorAccounts.id, lockedIntent.sponsorAccountId!)).for('update').limit(1)
    const [lockedTreasury] = await tx.select().from(sponsorTreasuries).where(eq(sponsorTreasuries.id, lockedSponsor?.treasuryId || '')).for('update').limit(1)
    const [lockedPolicy] = await tx.select().from(sponsorshipPolicies).where(eq(sponsorshipPolicies.id, lockedIntent.policyId!)).for('update').limit(1)
    const [control] = await tx.select().from(platformControls).where(eq(platformControls.key, 'sponsorship')).for('update').limit(1)
    const [grant] = await tx.select().from(sponsorshipGrants).where(and(
      eq(sponsorshipGrants.intentId, intentId),
      eq(sponsorshipGrants.tokenHash, tokenHash),
      eq(sponsorshipGrants.projectId, lockedIntent.projectId),
      eq(sponsorshipGrants.accountAddress, lockedIntent.accountAddress),
      eq(sponsorshipGrants.canonicalHash, lockedIntent.canonicalHash),
      eq(sponsorshipGrants.audience, 'xrpl-connect'),
      isNull(sponsorshipGrants.consumedAt),
      gt(sponsorshipGrants.expiresAt, now)
    )).for('update').limit(1)
    if (!lockedProject || !lockedOrganization || !lockedSponsor || !lockedTreasury || !lockedPolicy || lockedOrganization.status !== 'active' || lockedProject.status !== 'active' || lockedSponsor.status !== 'active' || lockedTreasury.status !== 'active' || lockedPolicy.status !== 'active') {
      throw createError({ statusCode: 409, statusMessage: 'Sponsorship is paused for this project' })
    }
    if (!control || control.paused) throw createError({ statusCode: 503, statusMessage: control ? 'Sponsorship is globally paused' : 'Sponsorship control is not initialized' })
    if (!grant || !hashesEqual(tokenHash, grant.tokenHash)) throw createError({ statusCode: 403, statusMessage: 'Grant is invalid, expired, or already consumed' })
    const lockedPolicyDecision = evaluatePolicy({
      policy: policyDocumentSchema.parse(lockedIntent.policySnapshot),
      transaction: unsignedEnvelope(signedTransaction),
      account: lockedIntent.accountAddress,
      feeDrops: lockedIntent.estimatedFeeDrops,
      reserveDrops: lockedIntent.estimatedReserveDrops
    })
    if (!lockedPolicyDecision.allowed) throw createError({ statusCode: 403, statusMessage: lockedPolicyDecision.code, data: { reason: lockedPolicyDecision.reason } })
    const required = context.intent.estimatedFeeDrops + context.intent.estimatedReserveDrops
    const [sharedBalance] = await tx.select().from(fundingBalances).where(eq(fundingBalances.treasuryId, lockedTreasury.id)).for('update').limit(1)
    const available = liveSpendableDrops - lockedTreasury.safetyBufferDrops - (sharedBalance?.pendingFeeDrops || 0n) - (sharedBalance?.pendingReserveDrops || 0n)
    if (available < required) throw createError({ statusCode: 409, statusMessage: 'Sponsor capacity is insufficient' })
    const sponsorSigned = await signer.signTransaction({
      network: lockedProject.network,
      intentId,
      canonicalTransaction: signedTransaction,
      expectedSignerAddress: lockedTreasury.address,
      expectedFeeDrops: lockedIntent.estimatedFeeDrops
    })
    await tx.update(sponsorTreasuries).set({ observedBalanceDrops, reconciledAt: now }).where(eq(sponsorTreasuries.id, lockedTreasury.id))
    let fundingCapacity: Awaited<ReturnType<typeof reserveFundingCapacity>>
    try {
      fundingCapacity = await reserveFundingCapacity(tx, { sponsorAccountId: lockedSponsor.id, treasuryId: lockedTreasury.id, projectId: lockedIntent.projectId, accountAddress: lockedIntent.accountAddress, feeDrops: lockedIntent.estimatedFeeDrops, reserveDrops: lockedIntent.estimatedReserveDrops, now })
    } catch (error) {
      if (error instanceof FundingCapacityError) throw createError({ statusCode: 409, statusMessage: error.code })
      throw error
    }
    await tx.insert(fundingLedgerEntries).values({ sponsorAccountId: lockedSponsor.id, treasuryId: lockedTreasury.id, intentId, type: 'reservation', feeDrops: lockedIntent.estimatedFeeDrops, reserveDrops: lockedIntent.estimatedReserveDrops, idempotencyKey: `intent:${intentId}:reservation`, reason: 'Wallet authorization accepted' })
    await tx.update(sponsorshipGrants).set({ consumedAt: now }).where(eq(sponsorshipGrants.id, grant.id))
    await tx.update(sponsorshipIntents).set({ state: 'submitting', userSignedBlob: parsed.data.signedTransaction.toUpperCase(), sponsorSigningHash: sponsorSigned.signingHash, quotaPeriodStart: fundingCapacity.periodStart, updatedAt: now }).where(eq(sponsorshipIntents.id, intentId))
    await tx.insert(intentEvents).values([
      { intentId, version: 2, fromState: 'awaiting_user_signature', toState: 'user_signature_received', actor: `wallet:${context.intent.accountAddress}` },
      { intentId, version: 3, fromState: 'user_signature_received', toState: 'verified', actor: 'system:policy' },
      { intentId, version: 4, fromState: 'verified', toState: 'awaiting_sponsor_signature', actor: 'system:signer' },
      { intentId, version: 5, fromState: 'awaiting_sponsor_signature', toState: 'submitting', actor: `signer:${sponsorSigned.keyReference}` }
    ])
    await tx.insert(submissions).values({ intentId, attempt: 1, signedBlob: sponsorSigned.signedBlob, transactionHash: sponsorSigned.txHash, endpoint: lockedProject.rpcUrl, firstSubmittedLedgerIndex: ledger.info.validated_ledger.seq })
    await tx.insert(outboxEvents).values({ aggregateType: 'sponsorship_intent', aggregateId: intentId, eventType: 'xrpl.submit', payload: { intentId, transactionHash: sponsorSigned.txHash } })
    return { replay: false as const, sponsorSigned }
  })

  setResponseStatus(event, 202)
  return signed.replay
    ? { intentId, state: signed.state, transactionHash: signed.transactionHash, engineResult: null }
    : { intentId, state: 'submitting', transactionHash: signed.sponsorSigned.txHash, engineResult: null }
})
