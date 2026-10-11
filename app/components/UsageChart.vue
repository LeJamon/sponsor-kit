<script setup lang="ts">
import { formatDropsAsXrp } from '~/utils/format'
import type { UsageRange, UsageSeriesPoint } from '~/utils/usage'

const props = defineProps<{ series: UsageSeriesPoint[], range: UsageRange }>()

const chartWidth = 760
const chartHeight = 300
const margin = { top: 28, right: 30, bottom: 48, left: 46 }
const plotWidth = chartWidth - margin.left - margin.right
const plotHeight = chartHeight - margin.top - margin.bottom

const dateFormatters: Record<UsageRange, Intl.DateTimeFormat> = {
  '24h': new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }),
  '7d': new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' }),
  '30d': new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' })
}

const chart = computed(() => {
  const points = props.series.map((point, index) => ({
    ...point,
    index,
    validated: Math.max(0, point.validated),
    failed: Math.max(0, point.failed),
    feeDrops: BigInt(point.feeSpentDrops)
  }))
  const maxCount = Math.max(1, ...points.map(point => point.validated + point.failed))
  const maxFeeDrops = points.reduce((maximum, point) => point.feeDrops > maximum ? point.feeDrops : maximum, 0n)
  const hasActivity = points.some(point => point.validated > 0 || point.failed > 0 || point.feeDrops > 0n)
  const slotWidth = points.length ? plotWidth / points.length : plotWidth
  const barWidth = Math.max(2, Math.min(22, slotWidth * 0.25))
  const feeScale = maxFeeDrops > 0n ? Number(maxFeeDrops) : 1
  const feePoints = points.map((point) => {
    const x = margin.left + slotWidth * (point.index + 0.5)
    const y = margin.top + plotHeight - Math.min(1, Number(point.feeDrops) / feeScale) * plotHeight
    return `${x},${y}`
  }).join(' ')
  return { points, maxCount, maxFeeDrops, hasActivity, slotWidth, barWidth, feePoints }
})

const yTicks = computed(() => [0, Math.ceil(chart.value.maxCount / 2), chart.value.maxCount])
const xTickIndexes = computed(() => {
  if (props.series.length <= 6) return props.series.map((_, index) => index)
  const step = Math.max(1, Math.ceil(props.series.length / 6))
  const indexes: number[] = []
  for (let index = 0; index < props.series.length; index += step) indexes.push(index)
  if (indexes.at(-1) !== props.series.length - 1) indexes.push(props.series.length - 1)
  return indexes
})
const hasActivity = computed(() => chart.value.hasActivity)
const ariaLabel = computed(() => `${props.range} sponsorship activity chart with ${props.series.reduce((total, point) => total + point.validated, 0)} validated and ${props.series.reduce((total, point) => total + point.failed, 0)} failed transactions.`)

function yForCount(value: number) {
  return margin.top + plotHeight - (value / chart.value.maxCount) * plotHeight
}

function xForBar(index: number, offset: number) {
  return margin.left + chart.value.slotWidth * index + (chart.value.slotWidth - chart.value.barWidth * 2 - 3) / 2 + offset
}

function heightForCount(value: number) {
  return (value / chart.value.maxCount) * plotHeight
}

function formatXAxis(timestamp: string) {
  return dateFormatters[props.range].format(new Date(timestamp))
}

function formatPointXAxis(index: number) {
  const point = chart.value.points[index]
  return point ? formatXAxis(point.timestamp) : ''
}
</script>

<template>
  <div>
    <div
      v-if="!hasActivity"
      class="rounded-xl border border-dashed border-[#D9E5F7] px-5 py-12 text-center"
    >
      <UIcon
        name="i-lucide-chart-no-axes-combined"
        class="size-7 text-[#8BA1C3]"
        aria-hidden="true"
      />
      <p class="mt-3 font-medium">
        No confirmed activity in this period
      </p>
      <p class="mt-1 text-sm text-[#62789C]">
        Validated and failed transactions will appear here after ledger confirmation.
      </p>
    </div>
    <figure
      v-else
      class="overflow-hidden"
    >
      <figcaption class="sr-only">
        {{ ariaLabel }}
      </figcaption>
      <svg
        :viewBox="`0 0 ${chartWidth} ${chartHeight}`"
        class="h-auto w-full"
        role="img"
        :aria-label="ariaLabel"
      >
        <line
          v-for="tick in yTicks"
          :key="`grid-${tick}`"
          :x1="margin.left"
          :x2="chartWidth - margin.right"
          :y1="yForCount(tick)"
          :y2="yForCount(tick)"
          stroke="#E9F0FA"
          stroke-width="1"
        />
        <line
          :x1="margin.left"
          :x2="margin.left"
          :y1="margin.top"
          :y2="margin.top + plotHeight"
          stroke="#B9CBE5"
          stroke-width="1"
        />
        <line
          :x1="margin.left"
          :x2="chartWidth - margin.right"
          :y1="margin.top + plotHeight"
          :y2="margin.top + plotHeight"
          stroke="#B9CBE5"
          stroke-width="1"
        />
        <text
          v-for="tick in yTicks"
          :key="`label-${tick}`"
          :x="margin.left - 10"
          :y="yForCount(tick) + 4"
          text-anchor="end"
          fill="#62789C"
          font-size="11"
        >{{ tick }}</text>
        <g
          v-for="point in chart.points"
          :key="point.timestamp"
        >
          <title>{{ formatXAxis(point.timestamp) }} · {{ point.validated }} validated · {{ point.failed }} failed · {{ formatDropsAsXrp(point.feeSpentDrops) }} fees</title>
          <rect
            :x="xForBar(point.index, 0)"
            :y="yForCount(point.validated)"
            :width="chart.barWidth"
            :height="heightForCount(point.validated)"
            rx="2"
            fill="#0A3DFF"
          />
          <rect
            :x="xForBar(point.index, chart.barWidth + 3)"
            :y="yForCount(point.failed)"
            :width="chart.barWidth"
            :height="heightForCount(point.failed)"
            rx="2"
            fill="#C9475C"
          />
        </g>
        <polyline
          v-if="chart.maxFeeDrops > 0n"
          :points="chart.feePoints"
          fill="none"
          stroke="#168A63"
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <circle
          v-for="point in chart.points"
          v-show="point.feeDrops > 0n"
          :key="`fee-${point.timestamp}`"
          :cx="margin.left + chart.slotWidth * (point.index + 0.5)"
          :cy="margin.top + plotHeight - Math.min(1, Number(point.feeDrops) / (chart.maxFeeDrops > 0n ? Number(chart.maxFeeDrops) : 1)) * plotHeight"
          r="3"
          fill="#168A63"
        />
        <text
          v-for="index in xTickIndexes"
          :key="`x-${index}`"
          :x="margin.left + chart.slotWidth * (index + 0.5)"
          :y="chartHeight - 17"
          text-anchor="middle"
          fill="#62789C"
          font-size="11"
        >{{ formatPointXAxis(index) }}</text>
      </svg>
      <div class="mt-2 flex flex-wrap justify-center gap-x-5 gap-y-2 text-xs text-[#62789C]">
        <span class="inline-flex items-center gap-1.5"><span
          class="size-2 rounded-sm bg-[#0A3DFF]"
          aria-hidden="true"
        />Validated</span>
        <span class="inline-flex items-center gap-1.5"><span
          class="size-2 rounded-sm bg-[#C9475C]"
          aria-hidden="true"
        />Failed</span>
        <span class="inline-flex items-center gap-1.5"><span
          class="h-0.5 w-3 rounded-full bg-[#168A63]"
          aria-hidden="true"
        />Fees spent</span>
      </div>
    </figure>
  </div>
</template>
