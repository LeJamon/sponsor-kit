<script setup lang="ts">
import { formatDropsAsXrp } from '~/utils/format'
import { usageRangeOptions } from '~/utils/usage'
import type { ProjectUsage, UsageRange } from '~/utils/usage'

const requestFetch = useRequestFetch()

definePageMeta({ layout: 'dashboard' })

const range = ref<UsageRange>('7d')
const policyId = ref('all')
const { projectId } = await useConsoleProject()
const usageKey = computed(() => `project-usage-${projectId.value || 'none'}-${range.value}-${policyId.value}`)
const { data, status, error, refresh } = await useAsyncData<ProjectUsage | null>(
  usageKey,
  () => projectId.value
    ? requestFetch<ProjectUsage>(`/api/console/projects/${projectId.value}/usage`, { query: { range: range.value, policyId: policyId.value === 'all' ? undefined : policyId.value } })
    : Promise.resolve(null),
  { watch: [projectId, range, policyId] }
)

watch(projectId, () => {
  policyId.value = 'all'
})

const policyOptions = computed(() => [
  { label: 'All policies', value: 'all' },
  ...(data.value?.policies || []).map(policy => ({
    label: `${policy.name} · v${policy.version}`,
    value: policy.id
  }))
])
const reserveDetail = computed(() => 'Current · project total')
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
      title="Sponsorship"
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

    <div class="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <p
        v-if="data"
        class="text-sm text-[#62789C]"
      >
        {{ periodLabel }}
      </p>
      <div class="grid gap-3 sm:grid-cols-2 sm:min-w-[28rem]">
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
          detail="Validated outcomes in period"
          icon="i-lucide-circle-check"
          tone="success"
        />
        <MetricCard
          label="Pending transactions"
          :value="String(data.totals.pending)"
          detail="Current pending snapshot"
          icon="i-lucide-clock-3"
          :tone="data.totals.pending ? 'warning' : 'success'"
        />
        <MetricCard
          label="Unsuccessful transactions"
          :value="String(data.totals.failed)"
          detail="Failed or otherwise unsuccessful outcomes"
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
          detail="Captured fees in period"
          icon="i-lucide-receipt"
        />
        <MetricCard
          label="Locked reserve"
          :value="formatDropsAsXrp(data.reserves.lockedDrops)"
          :detail="reserveDetail"
          icon="i-lucide-anchor"
        />
        <MetricCard
          label="Pending reserve"
          :value="formatDropsAsXrp(data.reserves.pendingDrops)"
          :detail="reserveDetail"
          icon="i-lucide-hourglass"
          :tone="data.reserves.pendingDrops !== '0' ? 'warning' : 'success'"
        />
      </div>

      <section class="acme-card mt-6 p-5 sm:p-6">
        <h2 class="font-semibold">
          Usage over time
        </h2>
        <div class="mt-5 grid gap-8 lg:grid-cols-2">
          <div>
            <h3 class="text-sm font-medium text-[#233B64]">
              Transactions
            </h3>
            <div class="mt-3">
              <UsageChart
                :series="data.series"
                :range="data.period.range"
                mode="transactions"
              />
            </div>
          </div>
          <div>
            <h3 class="text-sm font-medium text-[#233B64]">
              Fees spent
            </h3>
            <div class="mt-3">
              <UsageChart
                :series="data.series"
                :range="data.period.range"
                mode="fees"
              />
            </div>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>
