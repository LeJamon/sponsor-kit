import { asc, eq, sql } from 'drizzle-orm'
import {
  projectFundingBudgets,
  sponsorshipPolicies
} from '../database/schema'
import { useDatabase } from '../utils/database'

export const PROJECT_USAGE_RANGES = ['24h', '7d', '30d'] as const
export type ProjectUsageRange = typeof PROJECT_USAGE_RANGES[number]

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

export type ProjectUsagePeriod = {
  range: ProjectUsageRange
  from: Date
  to: Date
  bucketMilliseconds: number
  firstBucketMilliseconds: number
  bucketCount: number
}

const HOUR_MILLISECONDS = 60 * 60 * 1_000
const DAY_MILLISECONDS = 24 * HOUR_MILLISECONDS

const periodConfig: Record<ProjectUsageRange, { durationMilliseconds: number, bucketMilliseconds: number }> = {
  '24h': { durationMilliseconds: DAY_MILLISECONDS, bucketMilliseconds: HOUR_MILLISECONDS },
  '7d': { durationMilliseconds: 7 * DAY_MILLISECONDS, bucketMilliseconds: DAY_MILLISECONDS },
  '30d': { durationMilliseconds: 30 * DAY_MILLISECONDS, bucketMilliseconds: DAY_MILLISECONDS }
}

/**
 * Reporting periods are trailing windows ending at the request time. Series
 * buckets are UTC-aligned and include every bucket that intersects the
 * half-open period, including the partial first and last buckets.
 */
export function projectUsagePeriod(range: ProjectUsageRange, now = new Date()): ProjectUsagePeriod {
  const config = periodConfig[range]
  const toMilliseconds = now.getTime()
  const fromMilliseconds = toMilliseconds - config.durationMilliseconds
  const firstBucketMilliseconds = Math.floor(fromMilliseconds / config.bucketMilliseconds) * config.bucketMilliseconds
  const lastBucketMilliseconds = Math.floor((toMilliseconds - 1) / config.bucketMilliseconds) * config.bucketMilliseconds
  const bucketCount = Math.max(1, Math.floor((lastBucketMilliseconds - firstBucketMilliseconds) / config.bucketMilliseconds) + 1)

  return {
    range,
    from: new Date(fromMilliseconds),
    to: new Date(toMilliseconds),
    bucketMilliseconds: config.bucketMilliseconds,
    firstBucketMilliseconds,
    bucketCount
  }
}

function nonNegative(value: bigint): bigint {
  return value > 0n ? value : 0n
}

function percentage(validated: number, failed: number): number | null {
  const outcomes = BigInt(validated + failed)
  if (outcomes === 0n) return null
  // Keep two decimal places without introducing floating point drift while
  // preserving a percentage representation for the console UI.
  return Number((BigInt(validated) * 10_000n) / outcomes) / 100
}

function bucketUnit(period: ProjectUsagePeriod) {
  return sql.raw(period.bucketMilliseconds === HOUR_MILLISECONDS ? `'hour'` : `'day'`)
}

function policyFilter(policyId: string | undefined) {
  return policyId ? sql`and i."policy_id" = ${policyId}` : sql``
}

function aggregateDate(value: Date | string): Date {
  if (value instanceof Date) return value
  const text = String(value)
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(text) ? text : `${text}Z`)
}

function aggregateCount(value: string | number | bigint | null | undefined): number {
  return Number(value || 0)
}

function aggregateDrops(value: string | number | bigint | null | undefined): bigint {
  return BigInt(value || 0)
}

type OutcomeAggregateRow = {
  bucket: Date | string
  validated: string | number | bigint
  failed: string | number | bigint
}

type FeeAggregateRow = {
  bucket: Date | string
  feeSpentDrops: string | number | bigint
}

type PendingAggregateRow = {
  pending: string | number | bigint
}

/**
 * Read project usage from persisted intent and funding records. The method
 * intentionally does not call XRPL: a usage dashboard must reflect durable
 * accounting. Aggregates stay bounded by the requested UTC bucket count and
 * capture entries are deduplicated by intent before their actual fees are
 * summed.
 */
export async function readProjectUsage(input: {
  projectId: string
  range: ProjectUsageRange
  policyId?: string
  now?: Date
}): Promise<ProjectUsage> {
  const database = useDatabase()
  const period = projectUsagePeriod(input.range, input.now)
  const policyCondition = policyFilter(input.policyId)
  const unit = bucketUnit(period)

  const [policies, outcomeRows, feeRows, pendingRows, budgetRows] = await Promise.all([
    database.select({ id: sponsorshipPolicies.id, name: sponsorshipPolicies.name, version: sponsorshipPolicies.version, status: sponsorshipPolicies.status })
      .from(sponsorshipPolicies)
      .where(eq(sponsorshipPolicies.projectId, input.projectId))
      .orderBy(asc(sponsorshipPolicies.name), asc(sponsorshipPolicies.version)),
    database.execute<OutcomeAggregateRow>(sql`
      select
        date_trunc(${unit}, i."updated_at" at time zone 'UTC') at time zone 'UTC' as bucket,
        count(*) filter (where i."state" = 'validated')::text as validated,
        count(*) filter (where i."state" in ('failed', 'rejected', 'expired', 'cancelled', 'superseded'))::text as failed
      from "sponsorship_intents" i
      where i."project_id" = ${input.projectId}
        and i."updated_at" >= ${period.from.toISOString()}
        and i."updated_at" < ${period.to.toISOString()}
        ${policyCondition}
      group by 1
      order by 1
    `),
    database.execute<FeeAggregateRow>(sql`
      with captures as (
        select distinct on (f."intent_id")
          f."intent_id",
          f."created_at",
          f."fee_drops"
        from "funding_ledger_entries" f
        inner join "sponsorship_intents" i on i."id" = f."intent_id"
        where i."project_id" = ${input.projectId}
          and f."type" = 'capture'
          ${policyCondition}
        order by f."intent_id", f."created_at", f."id"
      ), period_captures as (
        select *
        from captures
        where "created_at" >= ${period.from.toISOString()}
          and "created_at" < ${period.to.toISOString()}
      )
      select
        date_trunc(${unit}, c."created_at" at time zone 'UTC') at time zone 'UTC' as bucket,
        coalesce(sum(c."fee_drops"), 0)::text as "feeSpentDrops"
      from period_captures c
      group by 1
      order by 1
    `),
    database.execute<PendingAggregateRow>(sql`
      select count(*)::text as pending
      from "sponsorship_intents" i
      where i."project_id" = ${input.projectId}
        and i."state" in ('created', 'awaiting_user_signature', 'user_signature_received', 'verified', 'awaiting_sponsor_signature', 'submitting', 'submitted')
        ${policyCondition}
    `),
    database.select({ reserveReservedDrops: projectFundingBudgets.reserveReservedDrops, reserveExposureDrops: projectFundingBudgets.reserveExposureDrops })
      .from(projectFundingBudgets)
      .where(eq(projectFundingBudgets.projectId, input.projectId))
      .limit(1)
  ])

  const series = Array.from({ length: period.bucketCount }, (_, index): ProjectUsageSeriesPoint => ({
    timestamp: new Date(period.firstBucketMilliseconds + index * period.bucketMilliseconds).toISOString(),
    validated: 0,
    failed: 0,
    feeSpentDrops: '0'
  }))

  let validated = 0
  let failed = 0
  let feeSpentDrops = 0n

  for (const row of outcomeRows) {
    const bucket = aggregateDate(row.bucket).getTime()
    const index = Math.floor((bucket - period.firstBucketMilliseconds) / period.bucketMilliseconds)
    if (index < 0 || index >= series.length) continue
    const point = series[index]
    if (!point) continue
    const rowValidated = aggregateCount(row.validated)
    const rowFailed = aggregateCount(row.failed)
    validated += rowValidated
    failed += rowFailed
    point.validated += rowValidated
    point.failed += rowFailed
  }

  for (const row of feeRows) {
    const bucket = aggregateDate(row.bucket).getTime()
    const index = Math.floor((bucket - period.firstBucketMilliseconds) / period.bucketMilliseconds)
    if (index < 0 || index >= series.length) continue
    const point = series[index]
    if (!point) continue
    const rowFees = aggregateDrops(row.feeSpentDrops)
    feeSpentDrops += rowFees
    point.feeSpentDrops = (BigInt(point.feeSpentDrops) + rowFees).toString()
  }

  const budget = budgetRows[0]
  const pendingReserveDrops = budget?.reserveReservedDrops || 0n
  const exposureDrops = budget?.reserveExposureDrops || 0n
  const lockedReserveDrops = nonNegative(exposureDrops - pendingReserveDrops)
  const pending = aggregateCount(pendingRows[0]?.pending)

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
