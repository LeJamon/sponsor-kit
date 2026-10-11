<script setup lang="ts">
import { formatDropsAsXrp } from '~/utils/format'
import type { UsageRange, UsageSeriesPoint } from '~/utils/usage'

type UsageChartMode = 'transactions' | 'fees'

const props = withDefaults(defineProps<{
  series: UsageSeriesPoint[]
  range: UsageRange
  mode?: UsageChartMode
}>(), {
  mode: 'transactions'
})

const chartWidth = 760
const chartHeight = 300
const margin = { top: 28, right: 30, bottom: 48, left: 100 }
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
  const maxCount = Math.max(0, ...points.map(point => point.validated + point.failed))
  const maxFeeDrops = points.reduce((maximum, point) => point.feeDrops > maximum ? point.feeDrops : maximum, 0n)
  const hasActivity = props.mode === 'fees'
    ? points.some(point => point.feeDrops > 0n)
    : points.some(point => point.validated > 0 || point.failed > 0)
  const slotWidth = points.length ? plotWidth / points.length : plotWidth
  const barWidth = Math.max(2, Math.min(22, slotWidth * 0.25))
  return { points, maxCount, maxFeeDrops, hasActivity, slotWidth, barWidth }
})

const yTicks = computed(() => {
  if (props.mode === 'fees') {
    const maximum = chart.value.maxFeeDrops
    const values = [0n, maximum / 2n, maximum]
    return [...new Set(values.map(value => value.toString()))].map((key) => {
      const value = BigInt(key)
      return { key: `fee-${key}`, value, label: formatDropsAsXrp(key) }
    })
  }

  const maximum = chart.value.maxCount
  const values = [0, Math.floor(maximum / 2), maximum]
  return [...new Set(values)].map(value => ({ key: `count-${value}`, value, label: String(value) }))
})

const xTickIndexes = computed(() => {
  if (props.series.length <= 6) return props.series.map((_, index) => index)
  const step = Math.max(1, Math.ceil(props.series.length / 6))
  const indexes: number[] = []
  for (let index = 0; index < props.series.length; index += step) indexes.push(index)
  if (indexes.at(-1) !== props.series.length - 1) indexes.push(props.series.length - 1)
  return indexes
})

const hasActivity = computed(() => chart.value.hasActivity)
const ariaLabel = computed(() => {
  if (props.mode === 'fees') {
    const feeSpentDrops = chart.value.points.reduce((total, point) => total + point.feeDrops, 0n)
    return `${props.range} sponsorship fees chart with ${formatDropsAsXrp(feeSpentDrops.toString())} spent.`
  }
  const validated = chart.value.points.reduce((total, point) => total + point.validated, 0)
  const failed = chart.value.points.reduce((total, point) => total + point.failed, 0)
  return `${props.range} sponsorship transactions chart with ${validated} validated and ${failed} unsuccessful transactions.`
})

function ratioFor(value: number | bigint) {
  if (props.mode === 'fees') {
    const maximum = chart.value.maxFeeDrops
    if (maximum <= 0n) return 0
    // Scale with integer arithmetic before converting to SVG coordinates so
    // large drop values never pass through an unsafe Number conversion.
    return Number((BigInt(value) * 1_000_000n) / maximum) / 1_000_000
  }
  const maximum = Math.max(1, chart.value.maxCount)
  return Number(value) / maximum
}

function yForValue(value: number | bigint) {
  return margin.top + plotHeight - ratioFor(value) * plotHeight
}

function xForBar(index: number, offset: number) {
  return margin.left + chart.value.slotWidth * index + (chart.value.slotWidth - chart.value.barWidth * 2 - 3) / 2 + offset
}

function xForFeeBar(index: number) {
  return margin.left + chart.value.slotWidth * index + (chart.value.slotWidth - chart.value.barWidth) / 2
}

function heightForValue(value: number | bigint) {
  return ratioFor(value) * plotHeight
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
    <p
      v-if="!hasActivity"
      class="py-10 text-center text-sm text-[#62789C]"
    >
      No activity in this period
    </p>
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
          :key="`grid-${tick.key}`"
          :x1="margin.left"
          :x2="chartWidth - margin.right"
          :y1="yForValue(tick.value)"
          :y2="yForValue(tick.value)"
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
          :key="`label-${tick.key}`"
          :x="margin.left - 10"
          :y="yForValue(tick.value) + 4"
          text-anchor="end"
          fill="#62789C"
          font-size="11"
        >{{ tick.label }}</text>
        <g
          v-for="point in chart.points"
          :key="`${point.timestamp}-${point.index}`"
        >
          <title v-if="mode === 'fees'">{{ formatXAxis(point.timestamp) }} · {{ formatDropsAsXrp(point.feeSpentDrops) }} fees spent</title>
          <title v-else>{{ formatXAxis(point.timestamp) }} · {{ point.validated }} validated · {{ point.failed }} unsuccessful</title>
          <template v-if="mode === 'transactions'">
            <rect
              :x="xForBar(point.index, 0)"
              :y="yForValue(point.validated)"
              :width="chart.barWidth"
              :height="heightForValue(point.validated)"
              rx="2"
              fill="#0A3DFF"
            />
            <rect
              :x="xForBar(point.index, chart.barWidth + 3)"
              :y="yForValue(point.failed)"
              :width="chart.barWidth"
              :height="heightForValue(point.failed)"
              rx="2"
              fill="#C9475C"
            />
          </template>
          <rect
            v-else
            :x="xForFeeBar(point.index)"
            :y="yForValue(point.feeDrops)"
            :width="chart.barWidth"
            :height="heightForValue(point.feeDrops)"
            rx="2"
            fill="#168A63"
          />
        </g>
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
        <template v-if="mode === 'transactions'">
          <span class="inline-flex items-center gap-1.5"><span
            class="size-2 rounded-sm bg-[#0A3DFF]"
            aria-hidden="true"
          />Validated</span>
          <span class="inline-flex items-center gap-1.5"><span
            class="size-2 rounded-sm bg-[#C9475C]"
            aria-hidden="true"
          />Unsuccessful</span>
        </template>
        <span
          v-else
          class="inline-flex items-center gap-1.5"
        ><span
          class="size-2 rounded-sm bg-[#168A63]"
          aria-hidden="true"
        />Fees spent</span>
      </div>
    </figure>
  </div>
</template>
