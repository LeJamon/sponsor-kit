export const usageRanges = ['24h', '7d', '30d'] as const
export type UsageRange = typeof usageRanges[number]

export type UsageSeriesPoint = {
  timestamp: string
  validated: number
  failed: number
  feeSpentDrops: string
}

export type UsagePolicy = {
  id: string
  name: string
  version: number
  status: 'draft' | 'active' | 'paused' | 'archived'
}

export type ProjectUsage = {
  period: { range: UsageRange, from: string, to: string }
  totals: {
    validated: number
    pending: number
    failed: number
    successRate: number | null
    feeSpentDrops: string
  }
  reserves: { lockedDrops: string, pendingDrops: string }
  series: UsageSeriesPoint[]
  policies: UsagePolicy[]
}

export const usageRangeOptions: Array<{ label: string, value: UsageRange }> = [
  { label: 'Last 24 hours', value: '24h' },
  { label: 'Last 7 days', value: '7d' },
  { label: 'Last 30 days', value: '30d' }
]
