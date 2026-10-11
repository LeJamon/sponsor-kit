import { and, asc, eq, gte, lt } from 'drizzle-orm'
import {
  fundingLedgerEntries,
  projectFundingBudgets,
  sponsorshipIntents,
  sponsorshipPolicies
} from '../database/schema'
import { useDatabase } from '../utils/database'

export const PROJECT_USAGE_RANGES = ['24h', '7d', '30d'] as const
export type ProjectUsageRange = typeof PROJECT_USAGE_RANGES[number]

type UsageIntentState = typeof sponsorshipIntents.state.enumValues[number]
type UsagePolicyStatus = typeof sponsorshipPolicies.status.enumValues[number]

export type ProjectUsagePolicy = {
  id: string
  name: string
  version: number
  status: UsagePolicyStatus
}

export type ProjectUsageSeriesPoint = {
  timestamp: string
  validated: number
  failed: number
  feeSpentDrops: string
}

export type ProjectUsage = {
  period: {
    range: ProjectUsageRange
    from: string
    to: string
  }
  totals: {
    validated: number
    pending: number
    failed: number
    /** Percentage in the range 0..100. Null means no terminal outcomes. */
    successRate: number | null
    feeSpentDrops: string
  }
  reserves: {
    lockedDrops: string
    pendingDrops: string
  }
  series: ProjectUsageSeriesPoint[]
  policies: ProjectUsagePolicy[]
}

type UsagePeriod = {
  range: ProjectUsageRange
  from: Date
  to: Date
  bucketMilliseconds: number
  bucketCount: number
}

const pendingStates = new Set<UsageIntentState>([
  'created',
  'awaiting_user_signature',
  'user_signature_received',
  'verified',
  'awaiting_sponsor_signature',
  'submitting',
  'submitted'
])

const failedStates = new Set<UsageIntentState>([
  'failed',
  'rejected',
  'expired',
  'cancelled',
  'superseded'
])

const periodConfig: Record<ProjectUsageRange, { bucketMilliseconds: number, bucketCount: number }> = {
  '24h': { bucketMilliseconds: 60 * 60 * 1_000, bucketCount: 24 },
  '7d': { bucketMilliseconds: 24 * 60 * 60 * 1_000, bucketCount: 7 },
  '30d': { bucketMilliseconds: 24 * 60 * 60 * 1_000, bucketCount: 30 }
}

/**
 * Usage windows are anchored to UTC bucket boundaries. This keeps the series
 * stable when the request arrives near a clock boundary while `to` remains
 * the actual request time.
 */
export function projectUsagePeriod(range: ProjectUsageRange, now = new Date()): UsagePeriod {
  const config = periodConfig[range]
  const toMilliseconds = now.getTime()
  const currentBucket = Math.floor(toMilliseconds / config.bucketMilliseconds) * config.bucketMilliseconds
  const fromMilliseconds = currentBucket - (config.bucketCount - 1) * config.bucketMilliseconds
  return {
    range,
    from: new Date(fromMilliseconds),
    to: new Date(toMilliseconds),
    ...config
  }
}

function nonNegative(value: bigint): bigint {
  return value > 0n ? value : 0n
}

function bucketIndex(value: Date, period: UsagePeriod): number | undefined {
  const index = Math.floor((value.getTime() - period.from.getTime()) / period.bucketMilliseconds)
  return index >= 0 && index < period.bucketCount ? index : undefined
}

function percentage(validated: number, failed: number): number | null {
  const outcomes = BigInt(validated + failed)
  if (outcomes === 0n) return null
  // Keep two decimal places without introducing floating point drift while
  // preserving a percentage representation for the console UI.
  return Number((BigInt(validated) * 10_000n / outcomes)) / 100
}

/**
 * Read project usage from persisted intent and funding records. The method
 * intentionally does not call XRPL: a usage dashboard must reflect durable
 * accounting, and every capture entry is idempotent per intent.
 */
export async function readProjectUsage(input: {
  projectId: string
  range: ProjectUsageRange
  policyId?: string
  now?: Date
}): Promise<ProjectUsage> {
  const database = useDatabase()
  const period = projectUsagePeriod(input.range, input.now)
  const intentFilters = [
    eq(sponsorshipIntents.projectId, input.projectId),
    gte(sponsorshipIntents.createdAt, period.from),
    lt(sponsorshipIntents.createdAt, period.to)
  ]
  if (input.policyId) intentFilters.push(eq(sponsorshipIntents.policyId, input.policyId))

  const [policies, intents, budgetRows] = await Promise.all([
    database.select({ id: sponsorshipPolicies.id, name: sponsorshipPolicies.name, version: sponsorshipPolicies.version, status: sponsorshipPolicies.status })
      .from(sponsorshipPolicies)
      .where(eq(sponsorshipPolicies.projectId, input.projectId))
      .orderBy(asc(sponsorshipPolicies.name), asc(sponsorshipPolicies.version)),
    database.select({ id: sponsorshipIntents.id, state: sponsorshipIntents.state, createdAt: sponsorshipIntents.createdAt })
      .from(sponsorshipIntents)
      .where(and(...intentFilters)),
    database.select({ reserveReservedDrops: projectFundingBudgets.reserveReservedDrops, reserveExposureDrops: projectFundingBudgets.reserveExposureDrops })
      .from(projectFundingBudgets)
      .where(eq(projectFundingBudgets.projectId, input.projectId))
      .limit(1)
  ])

  const captures = intents.length
    ? await database.select({ intentId: fundingLedgerEntries.intentId, feeDrops: fundingLedgerEntries.feeDrops, createdAt: fundingLedgerEntries.createdAt })
        .from(fundingLedgerEntries)
        .innerJoin(sponsorshipIntents, eq(sponsorshipIntents.id, fundingLedgerEntries.intentId))
        .where(and(
          eq(sponsorshipIntents.projectId, input.projectId),
          gte(sponsorshipIntents.createdAt, period.from),
          lt(sponsorshipIntents.createdAt, period.to),
          eq(fundingLedgerEntries.type, 'capture'),
          ...(input.policyId ? [eq(sponsorshipIntents.policyId, input.policyId)] : [])
        ))
        .orderBy(asc(fundingLedgerEntries.createdAt), asc(fundingLedgerEntries.id))
    : []

  // A capture is unique by the worker's intent idempotency key. Keeping the
  // first row also prevents a malformed legacy duplicate from inflating UI
  // totals if one is encountered before it can be reconciled.
  const captureByIntent = new Map<string, { feeDrops: bigint }>()
  for (const capture of captures) {
    if (!capture.intentId || captureByIntent.has(capture.intentId)) continue
    captureByIntent.set(capture.intentId, { feeDrops: BigInt(capture.feeDrops) })
  }

  const series = Array.from({ length: period.bucketCount }, (_, index): ProjectUsageSeriesPoint => ({
    timestamp: new Date(period.from.getTime() + index * period.bucketMilliseconds).toISOString(),
    validated: 0,
    failed: 0,
    feeSpentDrops: '0'
  }))
  let validated = 0
  let pending = 0
  let failed = 0
  let feeSpentDrops = 0n

  for (const intent of intents) {
    if (intent.state === 'validated') validated += 1
    else if (pendingStates.has(intent.state)) pending += 1
    else if (failedStates.has(intent.state)) failed += 1

    const index = bucketIndex(intent.createdAt, period)
    if (index === undefined) continue
    const point = series[index]
    if (!point) continue
    if (intent.state === 'validated') point.validated += 1
    else if (failedStates.has(intent.state)) point.failed += 1
    const capture = captureByIntent.get(intent.id)
    if (capture) {
      feeSpentDrops += capture.feeDrops
      point.feeSpentDrops = (BigInt(point.feeSpentDrops) + capture.feeDrops).toString()
    }
  }

  const budget = budgetRows[0]
  const pendingReserveDrops = budget?.reserveReservedDrops || 0n
  const exposureDrops = budget?.reserveExposureDrops || 0n
  const lockedReserveDrops = nonNegative(exposureDrops - pendingReserveDrops)

  return {
    period: { range: period.range, from: period.from.toISOString(), to: period.to.toISOString() },
    totals: {
      validated,
      pending,
      failed,
      successRate: percentage(validated, failed),
      feeSpentDrops: feeSpentDrops.toString()
    },
    reserves: {
      lockedDrops: lockedReserveDrops.toString(),
      pendingDrops: pendingReserveDrops.toString()
    },
    series,
    policies: policies.map(policy => ({ ...policy }))
  }
}
