<script setup lang="ts">
import { formatDateTime, formatDropsAsXrp } from '~/utils/format'

definePageMeta({ layout: 'dashboard' })
const { data: context } = await useFetch('/api/console/context')
const projectId = computed(() => context.value?.projects?.[0]?.project.publicId)
const { data, status, error, refresh } = await useAsyncData('project-funding', () => projectId.value ? $fetch(`/api/console/projects/${projectId.value}/funding`) : Promise.resolve(null), { watch: [projectId] })
const copied = ref(false)
async function copyAddress() {
  if (!data.value?.sponsor.address) {
    return
  }
  await navigator.clipboard.writeText(data.value.sponsor.address)
  copied.value = true
  setTimeout(() => {
    copied.value = false
  }, 1500)
}
</script>

<template>
  <div>
    <ConsolePageHeader
      eyebrow="Capital"
      title="Sponsor funding"
      description="Validated Devnet balance, required reserve, pending exposure, and append-only funding entries."
    >
      <UButton
        label="Refresh ledger"
        icon="i-lucide-refresh-cw"
        color="neutral"
        variant="outline"
        :loading="status === 'pending'"
        @click="refresh()"
      />
    </ConsolePageHeader>
    <UAlert
      v-if="error"
      color="error"
      variant="subtle"
      title="Funding is unavailable"
      :description="error.message"
    />
    <div
      v-else-if="status === 'pending' && !data"
      class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
    >
      <USkeleton
        v-for="index in 4"
        :key="index"
        class="h-36 rounded-2xl"
      />
    </div>
    <template v-else-if="data">
      <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Ledger balance"
          :value="formatDropsAsXrp(data.sponsor.observedBalanceDrops)"
          :detail="`Ledger ${data.sponsor.ledgerIndex.toLocaleString()}`"
          icon="i-lucide-landmark"
        /><MetricCard
          label="Available capacity"
          :value="formatDropsAsXrp(data.balance.availableDrops)"
          detail="After reserves and pending exposure"
          icon="i-lucide-gauge"
          tone="success"
        /><MetricCard
          label="Pending fees"
          :value="formatDropsAsXrp(data.balance.pendingFeeDrops)"
          detail="Authorized, not reconciled"
          icon="i-lucide-receipt"
          :tone="data.balance.pendingFeeDrops !== '0' ? 'warning' : 'success'"
        /><MetricCard
          label="Locked reserve"
          :value="formatDropsAsXrp(data.balance.lockedReserveDrops)"
          :detail="`${formatDropsAsXrp(data.balance.pendingReserveDrops)} pending`"
          icon="i-lucide-anchor"
        />
      </div>
      <section class="acme-card mt-6 p-5">
        <p class="text-xs font-medium text-[#62789C]">
          DEVNET SPONSOR ACCOUNT
        </p><div class="mt-2 flex flex-wrap items-center gap-3">
          <code class="break-all text-sm">{{ data.sponsor.address }}</code><UButton
            :label="copied ? 'Copied' : 'Copy'"
            icon="i-lucide-copy"
            color="neutral"
            variant="soft"
            @click="copyAddress"
          />
        </div><p class="mt-3 text-xs text-[#62789C]">
          Local signer · {{ data.sponsor.signerKeyReference }} · reconciled {{ formatDateTime(data.sponsor.reconciledAt) }}
        </p>
      </section>
      <section class="acme-card mt-6 overflow-hidden">
        <div class="border-b border-[#D9E5F7] px-5 py-4">
          <h2 class="font-semibold">
            Capital ledger
          </h2><p class="text-xs text-[#62789C]">
            Reservations, captures, releases, and reconciliations
          </p>
        </div><div
          v-if="data.entries.length"
          class="divide-y divide-[#E9F0FA]"
        >
          <div
            v-for="entry in data.entries"
            :key="entry.id"
            class="grid gap-2 px-5 py-4 text-sm sm:grid-cols-[1fr_1fr_1fr_auto]"
          >
            <span class="capitalize">{{ entry.type.replaceAll('_', ' ') }}</span><span class="font-mono text-xs">{{ entry.intentId || '—' }}</span><span>Fee {{ formatDropsAsXrp(entry.feeDrops) }} · Reserve {{ formatDropsAsXrp(entry.reserveDrops) }}</span><span class="text-xs text-[#62789C]">{{ formatDateTime(entry.createdAt) }}</span>
          </div>
        </div><div
          v-else
          class="px-5 py-12 text-center text-sm text-[#62789C]"
        >
          No capital movement has been recorded.
        </div>
      </section>
    </template>
  </div>
</template>
