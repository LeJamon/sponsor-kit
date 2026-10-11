<script setup lang="ts">
import { formatDropsAsXrp } from '~/utils/format'

const requestFetch = useRequestFetch()
definePageMeta({ layout: 'dashboard' })
const createOpen = useState('project-creation-open', () => false)
const { selected, projectId, error: contextError, refresh: refreshContext } = await useConsoleProject()
const range = ref('7d')
const ranges = [{ label: 'Last 24 hours', value: '24h' }, { label: 'Last 7 days', value: '7d' }, { label: 'Last 30 days', value: '30d' }]
const rangeLabel = computed(() => ranges.find(item => item.value === range.value)?.label)
const { data: usage, status, error, refresh } = await useAsyncData(`project-overview-usage-${projectId.value}`, () => projectId.value ? requestFetch(`/api/console/projects/${projectId.value}/usage`, { query: { range: range.value } }) : Promise.resolve(null), { watch: [range] })
const { data: recent, error: recentError, refresh: refreshRecent } = await useAsyncData(`project-overview-recent-${projectId.value}`, () => projectId.value ? requestFetch(`/api/console/projects/${projectId.value}/intents`, { query: { limit: 5 } }) : Promise.resolve(null))
const { data: readiness, error: readinessError } = await useFetch<{ ready: boolean }>('/api/console/readiness')
const toast = useToast()
async function copyProjectId() {
  if (!projectId.value) return
  try {
    await navigator.clipboard.writeText(projectId.value)
    toast.add({ title: 'Project ID copied', icon: 'i-lucide-check', color: 'success' })
  } catch {
    toast.add({ title: 'Could not copy project ID', description: projectId.value, color: 'error' })
  }
}
</script>

<template>
  <div>
    <ConsolePageHeader :title="selected?.project.name || 'Overview'">
      <template v-if="projectId">
        <UButton
          label="Copy project ID"
          icon="i-lucide-copy"
          color="neutral"
          variant="outline"
          @click="copyProjectId"
        />
        <USelect
          v-model="range"
          :items="ranges"
          aria-label="Overview period"
          class="min-w-36"
        />
      </template>
    </ConsolePageHeader>
    <UAlert
      v-if="contextError"
      title="Could not load projects"
      color="error"
      class="mb-6"
    >
      <template #actions>
        <UButton
          label="Retry"
          color="error"
          variant="soft"
          @click="refreshContext()"
        />
      </template>
    </UAlert>
    <section
      v-else-if="!projectId"
      class="acme-card px-6 py-16 text-center"
    >
      <h2 class="text-lg font-semibold">
        No projects yet
      </h2>
      <UButton
        class="mt-5"
        label="Create project"
        icon="i-lucide-plus"
        @click="createOpen = true"
      />
    </section>
    <template v-else>
      <UAlert
        v-if="readinessError || readiness?.ready === false"
        title="Sponsorship unavailable"
        color="warning"
        variant="subtle"
        class="mb-6"
      >
        <template #actions>
          <UButton
            to="/app/setup"
            label="Review checks"
            color="warning"
            variant="soft"
            trailing-icon="i-lucide-arrow-right"
          />
        </template>
      </UAlert>
      <UAlert
        v-if="error"
        title="Could not load usage"
        :description="error.message"
        color="error"
        class="mb-6"
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
        v-else-if="status === 'pending' && !usage"
        class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        <USkeleton
          v-for="index in 4"
          :key="index"
          class="h-40 rounded-xl"
        />
      </div>
      <template v-else-if="usage">
        <div
          class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
          :aria-busy="status === 'pending'"
        >
          <MetricCard
            label="Sponsored transactions"
            :value="String(usage.totals.validated)"
            :detail="rangeLabel"
          />
          <MetricCard
            label="Success rate"
            :value="usage.totals.successRate == null ? '—' : `${usage.totals.successRate.toFixed(1)}%`"
            :detail="rangeLabel"
          />
          <MetricCard
            label="Fees spent"
            :value="formatDropsAsXrp(usage.totals.feeSpentDrops)"
            :detail="rangeLabel"
          />
          <MetricCard
            label="Reserves locked"
            :value="formatDropsAsXrp(usage.reserves.lockedDrops)"
            detail="Current"
          />
        </div>
        <section class="acme-card mt-6 overflow-hidden">
          <div class="flex items-center justify-between gap-3 border-b border-[#E2E8F0] px-5 py-4">
            <h2 class="font-semibold">
              Activity
            </h2>
            <UButton
              to="/app/sponsorship/usage"
              label="View usage"
              trailing-icon="i-lucide-arrow-right"
              color="neutral"
              variant="ghost"
            />
          </div>
          <div class="p-5">
            <UsageChart
              :series="usage.series"
              :range="usage.period.range"
            />
          </div>
        </section>
      </template>
      <section
        v-if="recent && !recent.items.length"
        class="acme-card mt-6 flex flex-wrap items-center justify-between gap-4 px-5 py-4"
      >
        <h2 class="font-semibold">
          Get started
        </h2>
        <div class="flex flex-wrap gap-2">
          <UButton
            to="/app/api-keys"
            label="Create API key"
            icon="i-lucide-key-round"
            color="neutral"
            variant="outline"
          />
          <UButton
            to="/app/sponsorship"
            label="Configure sponsorship"
            color="neutral"
            variant="outline"
          />
          <UButton
            to="/docs"
            label="Integration guide"
            trailing-icon="i-lucide-arrow-up-right"
            color="neutral"
            variant="ghost"
          />
        </div>
      </section>
      <section class="acme-card mt-6 overflow-hidden">
        <div class="flex items-center justify-between border-b border-[#E2E8F0] px-5 py-4">
          <h2 class="font-semibold">
            Recent transactions
          </h2>
          <UButton
            to="/app/intents"
            label="View all"
            color="neutral"
            variant="ghost"
            trailing-icon="i-lucide-arrow-right"
          />
        </div>
        <div
          v-if="recentError"
          class="p-5"
        >
          <UAlert
            title="Could not load transactions"
            color="error"
          >
            <template #actions>
              <UButton
                label="Retry"
                color="error"
                variant="soft"
                @click="refreshRecent()"
              />
            </template>
          </UAlert>
        </div>
        <TransactionTable
          v-else-if="recent?.items.length"
          :items="recent.items"
        />
        <div
          v-else
          class="px-5 py-12 text-center text-sm text-[#62789C]"
        >
          No transactions yet
        </div>
      </section>
      <ProjectDangerZone
        v-if="selected && ['owner', 'admin'].includes(selected.role)"
        :key="selected.project.publicId"
        :project="selected.project"
      />
    </template>
  </div>
</template>
