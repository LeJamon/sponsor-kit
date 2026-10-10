import { and, desc, eq } from 'drizzle-orm'
import {
  fundingBalances,
  fundingLedgerEntries,
  projectFundingBudgets,
  projectFundingQuotas,
  projectSponsorAccounts,
  sponsorAccounts,
  sponsorTreasuries
} from '../database/schema'
import { useDatabase } from '../utils/database'
import { xrplRpc } from '../utils/xrpl-rpc'

export const DEFAULT_FEE_BUDGET_DROPS = 1_000_000n
export const DEFAULT_RESERVE_BUDGET_DROPS = 100_000_000n
export const DEFAULT_WALLET_FEE_QUOTA_DROPS = 100_000n
export const DEFAULT_WALLET_RESERVE_QUOTA_DROPS = 10_000_000n
export const DEFAULT_QUOTA_PERIOD_SECONDS = 86_400

type DatabaseTransaction = Parameters<Parameters<ReturnType<typeof useDatabase>['transaction']>[0]>[0]

export class FundingCapacityError extends Error {
  constructor(readonly code: 'PROJECT_FEE_BUDGET_EXCEEDED' | 'PROJECT_RESERVE_BUDGET_EXCEEDED' | 'WALLET_FEE_QUOTA_EXCEEDED' | 'WALLET_RESERVE_QUOTA_EXCEEDED') {
    super(code)
    this.name = 'FundingCapacityError'
  }
}

export function fundingBudgetDefaults() {
  return {
    feeBudgetDrops: DEFAULT_FEE_BUDGET_DROPS,
    reserveBudgetDrops: DEFAULT_RESERVE_BUDGET_DROPS,
    walletFeeQuotaDrops: DEFAULT_WALLET_FEE_QUOTA_DROPS,
    walletReserveQuotaDrops: DEFAULT_WALLET_RESERVE_QUOTA_DROPS,
    quotaPeriodSeconds: DEFAULT_QUOTA_PERIOD_SECONDS
  }
}

export function quotaPeriodStart(now: Date, periodSeconds: number): Date {
  if (!Number.isInteger(periodSeconds) || periodSeconds <= 0) throw new Error('Invalid funding quota period')
  return new Date(Math.floor(now.getTime() / (periodSeconds * 1_000)) * periodSeconds * 1_000)
}

async function ensureFundingBalance(tx: DatabaseTransaction, input: { sponsorAccountId: string, treasuryId: string }) {
  await tx.insert(fundingBalances).values(input).onConflictDoNothing()
  const [balance] = await tx.select().from(fundingBalances).where(eq(fundingBalances.treasuryId, input.treasuryId)).for('update').limit(1)
  if (!balance) throw new Error('Sponsor funding balance is unavailable')
  return balance
}

export async function ensureProjectFundingBudget(tx: DatabaseTransaction, projectId: string, lock = false) {
  await tx.insert(projectFundingBudgets).values({ projectId, ...fundingBudgetDefaults() }).onConflictDoNothing()
  const query = tx.select().from(projectFundingBudgets).where(eq(projectFundingBudgets.projectId, projectId))
  const [budget] = lock ? await query.for('update').limit(1) : await query.limit(1)
  if (!budget) throw new Error('Project funding budget is unavailable')
  return budget
}

async function ensureWalletQuota(tx: DatabaseTransaction, input: { projectId: string, accountAddress: string, periodStart: Date }) {
  await tx.insert(projectFundingQuotas).values(input).onConflictDoNothing()
  const [quota] = await tx.select().from(projectFundingQuotas).where(and(
    eq(projectFundingQuotas.projectId, input.projectId),
    eq(projectFundingQuotas.accountAddress, input.accountAddress),
    eq(projectFundingQuotas.periodStart, input.periodStart)
  )).for('update').limit(1)
  if (!quota) throw new Error('Wallet funding quota is unavailable')
  return quota
}

async function assertProjectTreasuryBinding(tx: DatabaseTransaction, input: { projectId: string, sponsorAccountId: string, treasuryId: string }) {
  const [binding] = await tx.select({ treasuryId: sponsorAccounts.treasuryId }).from(projectSponsorAccounts)
    .innerJoin(sponsorAccounts, eq(sponsorAccounts.id, projectSponsorAccounts.sponsorAccountId))
    .where(and(eq(projectSponsorAccounts.projectId, input.projectId), eq(projectSponsorAccounts.sponsorAccountId, input.sponsorAccountId), eq(sponsorAccounts.projectId, input.projectId)))
    .limit(1)
  if (!binding || binding.treasuryId !== input.treasuryId) throw new Error('Sponsor treasury is not bound to project')
}

function nonNegative(value: bigint): bigint {
  return value > 0n ? value : 0n
}

/** Reserve physical sponsor capacity and project/wallet budgets atomically. */
export async function reserveFundingCapacity(tx: DatabaseTransaction, input: {
  sponsorAccountId: string
  treasuryId: string
  projectId: string
  accountAddress: string
  feeDrops: bigint
  reserveDrops: bigint
  now: Date
}) {
  await assertProjectTreasuryBinding(tx, input)
  const balance = await ensureFundingBalance(tx, { sponsorAccountId: input.sponsorAccountId, treasuryId: input.treasuryId })
  const budget = await ensureProjectFundingBudget(tx, input.projectId, true)
  const periodStart = quotaPeriodStart(input.now, budget.quotaPeriodSeconds)
  const quota = await ensureWalletQuota(tx, { projectId: input.projectId, accountAddress: input.accountAddress, periodStart })

  if (budget.feeReservedDrops + budget.feeSpentDrops + input.feeDrops > budget.feeBudgetDrops) throw new FundingCapacityError('PROJECT_FEE_BUDGET_EXCEEDED')
  if (budget.reserveExposureDrops + input.reserveDrops > budget.reserveBudgetDrops) throw new FundingCapacityError('PROJECT_RESERVE_BUDGET_EXCEEDED')
  if (quota.feeReservedDrops + quota.feeSpentDrops + input.feeDrops > budget.walletFeeQuotaDrops) throw new FundingCapacityError('WALLET_FEE_QUOTA_EXCEEDED')
  if (quota.reserveExposureDrops + input.reserveDrops > budget.walletReserveQuotaDrops) throw new FundingCapacityError('WALLET_RESERVE_QUOTA_EXCEEDED')

  await tx.update(fundingBalances).set({
    pendingFeeDrops: balance.pendingFeeDrops + input.feeDrops,
    pendingReserveDrops: balance.pendingReserveDrops + input.reserveDrops,
    version: balance.version + 1,
    updatedAt: input.now
  }).where(eq(fundingBalances.treasuryId, input.treasuryId))
  await tx.update(projectFundingBudgets).set({
    feeReservedDrops: budget.feeReservedDrops + input.feeDrops,
    reserveReservedDrops: budget.reserveReservedDrops + input.reserveDrops,
    reserveExposureDrops: budget.reserveExposureDrops + input.reserveDrops,
    version: budget.version + 1,
    updatedAt: input.now
  }).where(eq(projectFundingBudgets.projectId, input.projectId))
  await tx.update(projectFundingQuotas).set({
    feeReservedDrops: quota.feeReservedDrops + input.feeDrops,
    reserveReservedDrops: quota.reserveReservedDrops + input.reserveDrops,
    reserveExposureDrops: quota.reserveExposureDrops + input.reserveDrops,
    version: quota.version + 1,
    updatedAt: input.now
  }).where(and(
    eq(projectFundingQuotas.projectId, input.projectId),
    eq(projectFundingQuotas.accountAddress, input.accountAddress),
    eq(projectFundingQuotas.periodStart, periodStart)
  ))
  return { balance, budget, quota, periodStart }
}

export async function releaseFundingReservation(tx: DatabaseTransaction, input: {
  sponsorAccountId: string
  treasuryId: string
  projectId: string
  accountAddress: string
  feeDrops: bigint
  reserveDrops: bigint
  now: Date
  periodStart?: Date | null
}) {
  await assertProjectTreasuryBinding(tx, input)
  const balance = await ensureFundingBalance(tx, { sponsorAccountId: input.sponsorAccountId, treasuryId: input.treasuryId })
  const budget = await ensureProjectFundingBudget(tx, input.projectId, true)
  const periodStart = input.periodStart || quotaPeriodStart(input.now, budget.quotaPeriodSeconds)
  const quota = await ensureWalletQuota(tx, { projectId: input.projectId, accountAddress: input.accountAddress, periodStart })
  await tx.update(fundingBalances).set({
    pendingFeeDrops: nonNegative(balance.pendingFeeDrops - input.feeDrops),
    pendingReserveDrops: nonNegative(balance.pendingReserveDrops - input.reserveDrops),
    version: balance.version + 1,
    updatedAt: input.now
  }).where(eq(fundingBalances.treasuryId, input.treasuryId))
  await tx.update(projectFundingBudgets).set({
    feeReservedDrops: nonNegative(budget.feeReservedDrops - input.feeDrops),
    reserveReservedDrops: nonNegative(budget.reserveReservedDrops - input.reserveDrops),
    reserveExposureDrops: nonNegative(budget.reserveExposureDrops - input.reserveDrops),
    version: budget.version + 1,
    updatedAt: input.now
  }).where(eq(projectFundingBudgets.projectId, input.projectId))
  await tx.update(projectFundingQuotas).set({
    feeReservedDrops: nonNegative(quota.feeReservedDrops - input.feeDrops),
    reserveReservedDrops: nonNegative(quota.reserveReservedDrops - input.reserveDrops),
    reserveExposureDrops: nonNegative(quota.reserveExposureDrops - input.reserveDrops),
    version: quota.version + 1,
    updatedAt: input.now
  }).where(and(
    eq(projectFundingQuotas.projectId, input.projectId),
    eq(projectFundingQuotas.accountAddress, input.accountAddress),
    eq(projectFundingQuotas.periodStart, periodStart)
  ))
}

export async function captureFunding(tx: DatabaseTransaction, input: {
  sponsorAccountId: string
  treasuryId: string
  projectId: string
  accountAddress: string
  estimatedFeeDrops: bigint
  estimatedReserveDrops: bigint
  actualFeeDrops: bigint
  successful: boolean
  now: Date
  periodStart?: Date | null
}) {
  await assertProjectTreasuryBinding(tx, input)
  const balance = await ensureFundingBalance(tx, { sponsorAccountId: input.sponsorAccountId, treasuryId: input.treasuryId })
  const budget = await ensureProjectFundingBudget(tx, input.projectId, true)
  const periodStart = input.periodStart || quotaPeriodStart(input.now, budget.quotaPeriodSeconds)
  const quota = await ensureWalletQuota(tx, { projectId: input.projectId, accountAddress: input.accountAddress, periodStart })
  const reserveToRelease = input.successful ? 0n : input.estimatedReserveDrops
  await tx.update(fundingBalances).set({
    pendingFeeDrops: nonNegative(balance.pendingFeeDrops - input.estimatedFeeDrops),
    pendingReserveDrops: nonNegative(balance.pendingReserveDrops - input.estimatedReserveDrops),
    capturedFeeDrops: balance.capturedFeeDrops + input.actualFeeDrops,
    lockedReserveDrops: balance.lockedReserveDrops + (input.successful ? input.estimatedReserveDrops : 0n),
    version: balance.version + 1,
    updatedAt: input.now
  }).where(eq(fundingBalances.treasuryId, input.treasuryId))
  await tx.update(projectFundingBudgets).set({
    feeReservedDrops: nonNegative(budget.feeReservedDrops - input.estimatedFeeDrops),
    feeSpentDrops: budget.feeSpentDrops + input.actualFeeDrops,
    reserveReservedDrops: nonNegative(budget.reserveReservedDrops - input.estimatedReserveDrops),
    reserveExposureDrops: nonNegative(budget.reserveExposureDrops - reserveToRelease),
    version: budget.version + 1,
    updatedAt: input.now
  }).where(eq(projectFundingBudgets.projectId, input.projectId))
  await tx.update(projectFundingQuotas).set({
    feeReservedDrops: nonNegative(quota.feeReservedDrops - input.estimatedFeeDrops),
    feeSpentDrops: quota.feeSpentDrops + input.actualFeeDrops,
    reserveReservedDrops: nonNegative(quota.reserveReservedDrops - input.estimatedReserveDrops),
    reserveExposureDrops: nonNegative(quota.reserveExposureDrops - reserveToRelease),
    version: quota.version + 1,
    updatedAt: input.now
  }).where(and(
    eq(projectFundingQuotas.projectId, input.projectId),
    eq(projectFundingQuotas.accountAddress, input.accountAddress),
    eq(projectFundingQuotas.periodStart, periodStart)
  ))
}

export async function releaseReserveExposure(tx: DatabaseTransaction, input: { projectId: string, accountAddress: string, reserveDrops: bigint, now: Date, periodStart?: Date | null }) {
  const budget = await ensureProjectFundingBudget(tx, input.projectId, true)
  const periodStart = input.periodStart || quotaPeriodStart(input.now, budget.quotaPeriodSeconds)
  const quota = await ensureWalletQuota(tx, { projectId: input.projectId, accountAddress: input.accountAddress, periodStart })
  await tx.update(projectFundingBudgets).set({
    reserveExposureDrops: nonNegative(budget.reserveExposureDrops - input.reserveDrops),
    version: budget.version + 1,
    updatedAt: input.now
  }).where(eq(projectFundingBudgets.projectId, input.projectId))
  await tx.update(projectFundingQuotas).set({
    reserveExposureDrops: nonNegative(quota.reserveExposureDrops - input.reserveDrops),
    version: quota.version + 1,
    updatedAt: input.now
  }).where(and(
    eq(projectFundingQuotas.projectId, input.projectId),
    eq(projectFundingQuotas.accountAddress, input.accountAddress),
    eq(projectFundingQuotas.periodStart, periodStart)
  ))
}

function stringifyBigInts<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, typeof item === 'bigint' ? item.toString() : item])) as T
}

export async function readProjectFunding(input: { projectId: string, rpcUrl: string, network: 'mainnet' | 'testnet' | 'devnet' }) {
  const database = useDatabase()
  const [binding] = await database.select({ binding: sponsorAccounts, treasury: sponsorTreasuries }).from(projectSponsorAccounts)
    .innerJoin(sponsorAccounts, eq(sponsorAccounts.id, projectSponsorAccounts.sponsorAccountId))
    .innerJoin(sponsorTreasuries, eq(sponsorTreasuries.id, sponsorAccounts.treasuryId))
    .where(and(eq(projectSponsorAccounts.projectId, input.projectId), eq(projectSponsorAccounts.network, input.network), eq(sponsorAccounts.status, 'active'), eq(sponsorTreasuries.status, 'active')))
    .limit(1)
  if (!binding) return null
  const sponsor = binding.treasury
  const [accountInfo, serverState] = await Promise.all([
    xrplRpc<{ account_data: { Balance: string, OwnerCount?: number, SponsoredOwnerCount?: number, SponsoringOwnerCount?: number, SponsoringAccountCount?: number, Sponsor?: string }, ledger_index: number }>(input.rpcUrl, 'account_info', { account: sponsor.address, ledger_index: 'validated', strict: true }),
    xrplRpc<{ state: { validated_ledger: { reserve_base: string | number, reserve_inc: string | number } } }>(input.rpcUrl, 'server_state', {})
  ])
  const accountReserveDrops = BigInt(serverState.state.validated_ledger.reserve_base)
  const objectReserveDrops = BigInt(serverState.state.validated_ledger.reserve_inc)
  const account = accountInfo.account_data
  const objectCount = BigInt(Math.max(0, (account.OwnerCount || 0) + (account.SponsoringOwnerCount || 0) - (account.SponsoredOwnerCount || 0)))
  const accountCount = BigInt(account.SponsoringAccountCount || 0)
  const currentReserveDrops = (account.Sponsor ? 0n : accountReserveDrops) + objectReserveDrops * objectCount + accountReserveDrops * accountCount
  const observedBalanceDrops = BigInt(account.Balance)
  const now = new Date()
  await database.update(sponsorTreasuries).set({ observedBalanceDrops, reconciledAt: now }).where(eq(sponsorTreasuries.id, sponsor.id))
  await database.insert(fundingBalances).values({ sponsorAccountId: binding.binding.id, treasuryId: sponsor.id }).onConflictDoNothing()
  const [balance, entries, budget] = await Promise.all([
    database.select().from(fundingBalances).where(eq(fundingBalances.treasuryId, sponsor.id)).limit(1).then(rows => rows[0]),
    database.select().from(fundingLedgerEntries).where(eq(fundingLedgerEntries.treasuryId, sponsor.id)).orderBy(desc(fundingLedgerEntries.createdAt)).limit(50),
    database.select().from(projectFundingBudgets).where(eq(projectFundingBudgets.projectId, input.projectId)).limit(1).then(rows => rows[0])
  ])
  const availableDrops = observedBalanceDrops - currentReserveDrops - sponsor.safetyBufferDrops - (balance?.pendingFeeDrops || 0n) - (balance?.pendingReserveDrops || 0n)
  const limits = budget || { ...fundingBudgetDefaults(), projectId: input.projectId, feeReservedDrops: 0n, feeSpentDrops: 0n, reserveReservedDrops: 0n, reserveExposureDrops: 0n, version: 0, updatedAt: now }
  return {
    sponsor: { ...binding.binding, treasuryId: sponsor.id, address: sponsor.address, signerProvider: sponsor.signerProvider, signerKeyReference: sponsor.signerKeyReference, capabilities: sponsor.capabilities, status: sponsor.status, observedBalanceDrops: observedBalanceDrops.toString(), safetyBufferDrops: sponsor.safetyBufferDrops.toString(), ledgerIndex: accountInfo.ledger_index },
    balance: {
      pendingFeeDrops: (balance?.pendingFeeDrops || 0n).toString(),
      capturedFeeDrops: (balance?.capturedFeeDrops || 0n).toString(),
      pendingReserveDrops: (balance?.pendingReserveDrops || 0n).toString(),
      lockedReserveDrops: (balance?.lockedReserveDrops || 0n).toString(),
      currentReserveDrops: currentReserveDrops.toString(),
      availableDrops: (availableDrops > 0n ? availableDrops : 0n).toString()
    },
    limits: {
      feeBudgetDrops: limits.feeBudgetDrops.toString(),
      reserveBudgetDrops: limits.reserveBudgetDrops.toString(),
      walletFeeQuotaDrops: limits.walletFeeQuotaDrops.toString(),
      walletReserveQuotaDrops: limits.walletReserveQuotaDrops.toString(),
      quotaPeriodSeconds: limits.quotaPeriodSeconds
    },
    usage: {
      feeReservedDrops: limits.feeReservedDrops.toString(),
      feeSpentDrops: limits.feeSpentDrops.toString(),
      reserveReservedDrops: limits.reserveReservedDrops.toString(),
      reserveExposureDrops: limits.reserveExposureDrops.toString()
    },
    entries: entries.map(entry => stringifyBigInts({ ...entry }))
  }
}
