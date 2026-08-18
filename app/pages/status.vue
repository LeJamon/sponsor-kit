<script setup lang="ts">
const { data, status, error, refresh } = await useFetch('/api/v1/health')
const services = computed(() => Object.entries(data.value?.checks || {}).map(([name, check]) => ({ name, ...check })))
</script>

<template>
  <UContainer class="py-24">
    <div class="mx-auto max-w-2xl text-center">
      <div
        class="mx-auto grid size-16 place-items-center rounded-full"
        :class="data?.status === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'"
      >
        <UIcon
          :name="data?.status === 'ok' ? 'i-lucide-circle-check' : 'i-lucide-triangle-alert'"
          class="size-8"
        />
      </div><h1 class="mt-6 text-4xl font-bold">
        {{ data?.status === 'ok' ? 'All systems operational' : status === 'pending' ? 'Checking systems' : 'Service degraded' }}
      </h1><p class="mt-3 text-[#62789C]">
        {{ data?.checkedAt ? `Checked ${new Date(data.checkedAt).toLocaleString()}` : 'Live service health from ACME.' }}
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
      v-if="error"
      class="mx-auto mt-8 max-w-2xl"
      color="error"
      title="Health endpoint unavailable"
      :description="error.message"
    /><div
      v-else
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
