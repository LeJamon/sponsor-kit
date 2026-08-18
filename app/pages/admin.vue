<script setup lang="ts">
definePageMeta({ layout: 'admin' })

type Overview = {
  checkedAt: string
  control: { paused: boolean, version: number, reason: string | null, updatedAt: string | null }
  metrics: { activeProjects: number, pendingIntents: number, validatedIntents: number, failedIntents: number, sponsorAccounts: number, observedBalanceDrops: string, pendingFeeDrops: string, pendingReserveDrops: string, lockedReserveDrops: string, pendingOutbox: number, oldestPendingOutboxAt: string | null }
  services: { database: { ok: boolean }, signer: { ok: boolean, provider: string, keyReference?: string, address?: string, error?: string }, workers: Array<{ workerName: string, status: string, stale: boolean, lastHeartbeatAt: string }> }
  network: Array<{ id: string, network: string, networkId: number, ledgerIndex: number, definitionsHash: string, amendmentId: string, serverVersion: string, endpointHealthy: boolean, observedAt: string }>
  audit: Array<{ id: string, action: string, actor: string, resourceType: string, resourceId: string, result: string, createdAt: string }>
}

const { data, status, error, refresh } = await useFetch<Overview>('/api/admin/overview')
const showControl = ref(false)
const reason = ref('')
const changingControl = ref(false)
const controlError = ref('')

function formatXrp(drops: string | undefined) {
  if (!drops) return '—'
  const value = BigInt(drops)
  const whole = value / 1_000_000n
  const fraction = (value % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '')
  return `${whole.toLocaleString()}${fraction ? `.${fraction}` : ''} XRP`
}

function shortHash(value: string | undefined) {
  return value ? `${value.slice(0, 8)}…${value.slice(-6)}` : '—'
}

async function updateControl() {
  if (!data.value || reason.value.trim().length < 8) return
  changingControl.value = true
  controlError.value = ''
  try {
    await $fetch('/api/admin/sponsorship-control', {
      method: 'PUT',
      body: { paused: !data.value.control.paused, expectedVersion: data.value.control.version, reason: reason.value.trim() }
    })
    reason.value = ''
    showControl.value = false
    await refresh()
  } catch (requestError: unknown) {
    controlError.value = requestError instanceof Error ? requestError.message : 'The control update failed.'
  } finally {
    changingControl.value = false
  }
}

const serviceRows = computed(() => {
  if (!data.value) return []
  const rows = [
    { name: 'Database', detail: 'PostgreSQL query', ok: data.value.services.database.ok, state: data.value.services.database.ok ? 'Healthy' : 'Unavailable' },
    { name: 'Sponsor signer', detail: data.value.services.signer.ok ? `${data.value.services.signer.provider} · ${data.value.services.signer.keyReference}` : (data.value.services.signer.error || 'Unavailable'), ok: data.value.services.signer.ok, state: data.value.services.signer.ok ? 'Healthy' : 'Unavailable' },
    ...data.value.services.workers.map(worker => ({ name: worker.workerName, detail: `Last heartbeat ${new Date(worker.lastHeartbeatAt).toLocaleString()}`, ok: !worker.stale && worker.status === 'running', state: worker.stale ? 'Stale' : worker.status }))
  ]
  if (!data.value.services.workers.length) rows.push({ name: 'Background workers', detail: 'No heartbeat has been observed', ok: false, state: 'Unknown' })
  return rows
})
</script>

<template>
  <div>
    <ConsolePageHeader
      eyebrow="Platform operations"
      title="Admin control plane"
      description="Live sponsor capital, signing, network, queues, reconciliation, and tenant safety controls."
    >
      <div class="flex gap-2">
        <UButton
          label="Refresh"
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="outline"
          :loading="status === 'pending'"
          @click="refresh()"
        />
        <UButton
          v-if="data"
          :label="data.control.paused ? 'Resume sponsorship' : 'Emergency pause'"
          :icon="data.control.paused ? 'i-lucide-play' : 'i-lucide-octagon-pause'"
          :color="data.control.paused ? 'success' : 'error'"
          variant="outline"
          @click="showControl = !showControl"
        />
      </div>
    </ConsolePageHeader>

    <UAlert
      v-if="error"
      color="error"
      variant="subtle"
      title="Admin data is unavailable"
      :description="error.message"
      icon="i-lucide-triangle-alert"
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
        v-for="index in 4"
        :key="index"
        class="h-36 rounded-2xl"
      />
    </div>

    <template v-else-if="data">
      <UAlert
        v-if="data.control.paused"
        class="mb-5"
        color="error"
        variant="subtle"
        title="Sponsorship is paused"
        :description="data.control.reason || 'Signing and submission are blocked.'"
        icon="i-lucide-octagon-pause"
      />
      <section
        v-if="showControl"
        class="acme-card mb-5 p-5"
      >
        <h2 class="font-semibold">
          {{ data.control.paused ? 'Resume all sponsorship' : 'Pause all sponsorship' }}
        </h2>
        <p class="mt-1 text-sm text-[#62789C]">
          The reason is recorded in the audit trail. The control is rechecked immediately before signing and submission.
        </p>
        <UFormField
          label="Operational reason"
          class="mt-4"
          :error="controlError || undefined"
        >
          <UTextarea
            v-model="reason"
            class="w-full"
            :placeholder="data.control.paused ? 'Incident resolved and verified…' : 'Describe the incident or safety concern…'"
          />
        </UFormField>
        <div class="mt-4 flex gap-2">
          <UButton
            :label="data.control.paused ? 'Resume sponsorship' : 'Pause sponsorship'"
            :color="data.control.paused ? 'success' : 'error'"
            :loading="changingControl"
            :disabled="reason.trim().length < 8"
            @click="updateControl"
          />
          <UButton
            label="Cancel"
            color="neutral"
            variant="ghost"
            @click="showControl = false"
          />
        </div>
      </section>

      <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Active projects"
          :value="String(data.metrics.activeProjects)"
          :detail="`${data.metrics.sponsorAccounts} sponsor accounts`"
          icon="i-lucide-box"
        />
        <MetricCard
          label="Pending intents"
          :value="String(data.metrics.pendingIntents)"
          :detail="`${data.metrics.pendingOutbox} queued operations`"
          icon="i-lucide-list-restart"
          :tone="data.metrics.pendingIntents ? 'warning' : 'success'"
        />
        <MetricCard
          label="Sponsor balance"
          :value="formatXrp(data.metrics.observedBalanceDrops)"
          detail="Validated ledger balance"
          icon="i-lucide-landmark"
        />
        <MetricCard
          label="Reserve exposure"
          :value="formatXrp(data.metrics.lockedReserveDrops)"
          :detail="`${formatXrp(data.metrics.pendingReserveDrops)} pending`"
          icon="i-lucide-anchor"
        />
      </div>

      <div class="mt-6 grid gap-6 xl:grid-cols-2">
        <section class="acme-card overflow-hidden">
          <div class="border-b border-[#D9E5F7] px-5 py-4">
            <h2 class="font-semibold">
              System health
            </h2><p class="text-xs text-[#62789C]">
              Unknown and stale services are never reported as healthy
            </p>
          </div>
          <div class="divide-y divide-[#E9F0FA]">
            <div
              v-for="service in serviceRows"
              :key="service.name"
              class="flex items-center gap-4 px-5 py-4"
            >
              <span
                class="size-2.5 rounded-full"
                :class="service.ok ? 'bg-emerald-500' : 'bg-amber-500'"
              />
              <div class="flex-1">
                <p class="font-medium">
                  {{ service.name }}
                </p><p class="text-xs text-[#62789C]">
                  {{ service.detail }}
                </p>
              </div>
              <UBadge
                :label="service.state"
                :color="service.ok ? 'success' : 'warning'"
                variant="subtle"
              />
            </div>
          </div>
        </section>

        <section class="acme-card overflow-hidden">
          <div class="border-b border-[#D9E5F7] px-5 py-4">
            <h2 class="font-semibold">
              Audit trail
            </h2><p class="text-xs text-[#62789C]">
              Security and operational mutations
            </p>
          </div>
          <div
            v-if="data.audit.length"
            class="divide-y divide-[#E9F0FA]"
          >
            <div
              v-for="entry in data.audit"
              :key="entry.id"
              class="grid grid-cols-[1fr_auto] gap-1 px-5 py-4"
            >
              <p class="font-mono text-xs font-semibold">
                {{ entry.action }}
              </p><p class="text-xs text-[#62789C]">
                {{ new Date(entry.createdAt).toLocaleString() }}
              </p>
              <p class="text-xs text-[#62789C]">
                {{ entry.actor }} · {{ entry.resourceType }}:{{ entry.resourceId }}
              </p>
            </div>
          </div>
          <div
            v-else
            class="px-5 py-10 text-center text-sm text-[#62789C]"
          >
            No audit events have been recorded.
          </div>
        </section>
      </div>

      <section class="acme-card mt-6 overflow-hidden">
        <div class="border-b border-[#D9E5F7] px-5 py-4">
          <h2 class="font-semibold">
            Devnet protocol observations
          </h2><p class="text-xs text-[#62789C]">
            Server-advertised and hash-pinned definitions used by the signer
          </p>
        </div>
        <div
          v-if="data.network.length"
          class="divide-y divide-[#E9F0FA]"
        >
          <div
            v-for="snapshot in data.network"
            :key="snapshot.id"
            class="grid gap-2 px-5 py-4 text-sm md:grid-cols-5"
          >
            <div>
              <p class="text-xs text-[#62789C]">
                Network
              </p><p class="font-medium">
                {{ snapshot.network }} · {{ snapshot.networkId }}
              </p>
            </div>
            <div>
              <p class="text-xs text-[#62789C]">
                Ledger
              </p><p class="font-medium">
                {{ snapshot.ledgerIndex.toLocaleString() }}
              </p>
            </div>
            <div>
              <p class="text-xs text-[#62789C]">
                rippled
              </p><p class="font-medium">
                {{ snapshot.serverVersion }}
              </p>
            </div>
            <div>
              <p class="text-xs text-[#62789C]">
                Definitions
              </p><p class="font-mono text-xs">
                {{ shortHash(snapshot.definitionsHash) }}
              </p>
            </div>
            <div>
              <p class="text-xs text-[#62789C]">
                Observed
              </p><p class="font-medium">
                {{ new Date(snapshot.observedAt).toLocaleString() }}
              </p>
            </div>
          </div>
        </div>
        <div
          v-else
          class="px-5 py-10 text-center text-sm text-[#62789C]"
        >
          No network observation has been persisted yet.
        </div>
      </section>
      <p class="mt-4 text-right text-xs text-[#62789C]">
        Checked {{ new Date(data.checkedAt).toLocaleString() }}
      </p>
    </template>
  </div>
</template>
