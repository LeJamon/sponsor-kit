<script setup lang="ts">
type HealthReport = { status: string, checkedAt?: string, checks?: Record<string, { ok: boolean, detail?: string }> }
const { data, status, error, refresh } = await useFetch<HealthReport>('/api/v1/health')
const report = computed<HealthReport | null>(() => {
  if (data.value) return data.value
  const candidate = error.value?.data
  if (!candidate || typeof candidate !== 'object') return null
  const value = candidate as Partial<HealthReport>
  return typeof value.status === 'string' && value.checks ? value as HealthReport : null
})
const services = computed(() => Object.entries(report.value?.checks || {}).map(([name, check]) => ({ name, ...check })))
</script>

<template>
  <UContainer class="py-24">
    <div class="mx-auto max-w-2xl text-center">
      <div
        class="mx-auto grid size-16 place-items-center rounded-full"
        :class="report?.status === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'"
      >
        <UIcon
          :name="report?.status === 'ok' ? 'i-lucide-circle-check' : status === 'pending' ? 'i-lucide-loader-circle' : 'i-lucide-triangle-alert'"
          class="size-8"
        />
      </div><h1 class="mt-6 text-4xl font-bold">
        {{ report?.status === 'ok' ? 'All systems operational' : status === 'pending' ? 'Checking systems' : report ? 'Service degraded' : 'Health status unavailable' }}
      </h1><p class="mt-3 text-[#62789C]">
        {{ report?.checkedAt ? `Checked ${new Date(report.checkedAt).toLocaleString()}` : 'Live service health from ACME.' }}
      </p><UButton
        class="mt-5"
        label="Refresh"
        icon="i-lucide-refresh-cw"
        color="neutral"
        variant="outline"
        :loading="status === 'pending'"
        @click="refresh()"
      />
    </div><UAlert
      v-if="error && !report"
      class="mx-auto mt-8 max-w-2xl"
      color="error"
      title="Health endpoint unavailable"
      :description="error.message"
    /><div
      v-if="report"
      class="acme-card mx-auto mt-10 max-w-2xl divide-y divide-[#E9F0FA]"
    >
      <div
        v-for="service in services"
        :key="service.name"
        class="flex items-center justify-between gap-4 px-5 py-4"
      >
        <div>
          <span class="font-medium capitalize">{{ service.name }}</span><p
            v-if="service.detail"
            class="mt-1 text-xs text-[#62789C]"
          >
            {{ service.detail }}
          </p>
        </div><UBadge
          :label="service.ok ? 'Operational' : 'Degraded'"
          :color="service.ok ? 'success' : 'warning'"
          variant="subtle"
        />
      </div>
    </div>
  </UContainer>
</template>
