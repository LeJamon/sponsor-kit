<script setup lang="ts">
import { formatDropsAsXrp } from '~/utils/format'
import { usageRangeOptions } from '~/utils/usage'
import type { ProjectUsage, UsageRange } from '~/utils/usage'

const requestFetch = useRequestFetch()

definePageMeta({ layout: 'dashboard' })

const range = ref<UsageRange>('7d')
const policyId = ref('')
const { projectId } = await useConsoleProject()
const usageKey = computed(() => `project-usage-${projectId.value || 'none'}-${range.value}-${policyId.value || 'all'}`)
const { data, status, error, refresh } = await useAsyncData<ProjectUsage | null>(
  usageKey,
  () => projectId.value
    ? requestFetch<ProjectUsage>(`/api/console/projects/${projectId.value}/usage`, { query: { range: range.value, policyId: policyId.value || undefined } })
    : Promise.resolve(null),
  { watch: [projectId, range, policyId] }
)

const policyOptions = computed(() => [
  { label: 'All policies', value: '' },
  ...(data.value?.policies || []).map(policy => ({
    label: `${policy.name} · v${policy.version}`,
    value: policy.id
  }))
])
const successRateLabel = computed(() => data.value?.totals.successRate == null ? '—' : `${data.value.totals.successRate.toFixed(2)}%`)
const periodLabel = computed(() => {
  if (!data.value) return ''
  const formatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })
  return `${formatter.format(new Date(data.value.period.from))} – ${formatter.format(new Date(data.value.period.to))} UTC`
})
</script>

<template>
  <div>
    <ConsolePageHeader
      eyebrow="Sponsorship"
      title="Usage"
      description="Confirmed sponsorship activity and project reserve exposure from durable ledger accounting."
    >
      <UButton
        label="Refresh"
        icon="i-lucide-refresh-cw"
        color="neutral"
        variant="outline"
        :loading="status === 'pending'"
        @click="refresh()"
      />
    </ConsolePageHeader>

    <SponsorshipTabs />

    <section class="acme-card mb-6 p-4 sm:p-5">
      <div class="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p class="text-xs font-semibold uppercase tracking-[.14em] text-[#62789C]">
            Reporting period
          </p>
          <p class="mt-1 text-sm text-[#62789C]">
            {{ data ? periodLabel : 'Choose a period to load confirmed activity.' }}
          </p>
        </div>
        <div class="grid gap-3 sm:grid-cols-2 md:min-w-[28rem]">
          <UFormField label="Period">
            <USelect
              v-model="range"
              :items="usageRangeOptions"
              value-key="value"
              class="w-full"
            />
          </UFormField>
          <UFormField label="Policy">
            <USelect
              v-model="policyId"
              :items="policyOptions"
              value-key="value"
              class="w-full"
            />
          </UFormField>
        </div>
      </div>
    </section>

    <UAlert
      v-if="error"
      color="error"
      variant="subtle"
      title="Usage is unavailable"
      :description="error.message"
    >
      <template #actions>
        <UButton
          label="Retry"
          color="error"
          variant="soft"
          @click="refresh()"
        />
      </template>
    </UAlert>

    <div
      v-else-if="status === 'pending' && !data"
      class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
    >
      <USkeleton
        v-for="index in 7"
        :key="index"
        class="h-32 rounded-2xl"
      />
    </div>

    <template v-else-if="data">
      <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Validated transactions"
          :value="String(data.totals.validated)"
          detail="Confirmed in the selected period"
          icon="i-lucide-circle-check"
          tone="success"
        />
        <MetricCard
          label="Pending transactions"
          :value="String(data.totals.pending)"
          detail="Still awaiting completion"
          icon="i-lucide-clock-3"
          :tone="data.totals.pending ? 'warning' : 'success'"
        />
        <MetricCard
          label="Failed transactions"
          :value="String(data.totals.failed)"
          detail="Confirmed unsuccessful outcomes"
          icon="i-lucide-circle-x"
          :tone="data.totals.failed ? 'warning' : 'success'"
        />
        <MetricCard
          label="Success rate"
          :value="successRateLabel"
          detail="Validated ÷ terminal outcomes"
          icon="i-lucide-activity"
          tone="success"
        />
        <MetricCard
          label="Fees spent"
          :value="formatDropsAsXrp(data.totals.feeSpentDrops)"
          detail="Confirmed funding captures"
          icon="i-lucide-receipt"
        />
        <MetricCard
          label="Locked reserve"
          :value="formatDropsAsXrp(data.reserves.lockedDrops)"
          detail="Active project obligations"
          icon="i-lucide-anchor"
        />
        <MetricCard
          label="Pending reserve"
          :value="formatDropsAsXrp(data.reserves.pendingDrops)"
          detail="Reserved for in-flight intents"
          icon="i-lucide-hourglass"
          :tone="data.reserves.pendingDrops !== '0' ? 'warning' : 'success'"
        />
      </div>

      <section class="acme-card mt-6 p-5 sm:p-6">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p class="acme-kicker">
              Confirmed activity
            </p>
            <h2 class="mt-1 font-semibold">
              Sponsorship outcomes
            </h2>
            <p class="mt-1 text-sm text-[#62789C]">
              UTC buckets show intents created in the selected period; fees are counted only after a durable funding capture.
            </p>
          </div>
          <UBadge
            :label="data.period.range"
            color="neutral"
            variant="subtle"
          />
        </div>
        <div class="mt-5">
          <UsageChart
            :series="data.series"
            :range="data.period.range"
          />
        </div>
      </section>
    </template>
  </div>
</template>
