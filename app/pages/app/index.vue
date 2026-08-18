<script setup lang="ts">
import { formatDateTime, formatDropsAsXrp, shortenAddress } from '~/utils/format'

definePageMeta({ layout: 'dashboard' })
const { data: context } = await useFetch('/api/console/context')
const projectId = computed(() => context.value?.projects?.[0]?.project.publicId)
const { data, status, error, refresh } = await useAsyncData('project-overview', () => projectId.value ? $fetch(`/api/console/projects/${projectId.value}/overview`) : Promise.resolve(null), { watch: [projectId] })
</script>

<template>
  <div>
    <ConsolePageHeader
      eyebrow="Developer console"
      :title="data ? `${data.project.name} overview` : 'Project overview'"
      description="Validated Devnet activity, sponsor capacity, and recent intents from the backend."
    >
      <UButton
        to="/docs"
        label="Integration guide"
        icon="i-lucide-book-open"
        color="primary"
      />
    </ConsolePageHeader>
    <UAlert
      v-if="error"
      color="error"
      variant="subtle"
      title="Project data is unavailable"
      :description="error.message"
    >
      <template #actions>
        <UButton
          label="Retry"
          @click="refresh()"
        />
      </template>
    </UAlert>
    <div
      v-else-if="status === 'pending'"
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
          label="Validated intents"
          :value="String(data.metrics.validated)"
          detail="Confirmed on Devnet"
          icon="i-lucide-circle-check"
          tone="success"
        />
        <MetricCard
          label="Pending intents"
          :value="String(data.metrics.pending)"
          detail="Awaiting authorization or validation"
          icon="i-lucide-clock-3"
          :tone="data.metrics.pending ? 'warning' : 'success'"
        />
        <MetricCard
          label="Available sponsor capacity"
          :value="formatDropsAsXrp(data.funding?.availableDrops)"
          detail="After reserve, safety buffer, and pending exposure"
          icon="i-lucide-landmark"
        />
        <MetricCard
          label="Locked reserve"
          :value="formatDropsAsXrp(data.funding?.lockedReserveDrops)"
          :detail="`${formatDropsAsXrp(data.funding?.pendingReserveDrops)} pending`"
          icon="i-lucide-anchor"
        />
      </div>
      <section class="acme-card mt-6 overflow-hidden">
        <div class="flex items-center justify-between border-b border-[#D9E5F7] px-5 py-4">
          <div>
            <h2 class="font-semibold">
              Recent intents
            </h2><p class="text-xs text-[#62789C]">
              Durable sponsorship state
            </p>
          </div><UButton
            to="/app/intents"
            label="View all"
            color="neutral"
            variant="ghost"
          />
        </div>
        <div
          v-if="data.recentIntents.length"
          class="divide-y divide-[#E9F0FA]"
        >
          <div
            v-for="intent in data.recentIntents"
            :key="intent.id"
            class="grid items-center gap-3 px-5 py-4 text-sm md:grid-cols-[1.1fr_1fr_1fr_auto_auto]"
          >
            <span class="font-mono text-xs">{{ intent.id }}</span><span>{{ shortenAddress(intent.accountAddress) }}</span><span>{{ intent.canonicalTransaction.TransactionType }}</span><IntentStatus :status="intent.state" /><span class="text-xs text-[#62789C]">{{ formatDateTime(intent.createdAt) }}</span>
          </div>
        </div>
        <div
          v-else
          class="px-5 py-12 text-center text-sm text-[#62789C]"
        >
          No sponsorship intent has been created yet.
        </div>
      </section>
      <section class="acme-card mt-6 p-5">
        <h2 class="font-semibold">
          Sponsor signer
        </h2><div class="mt-3 grid gap-4 text-sm sm:grid-cols-3">
          <div>
            <p class="text-xs text-[#62789C]">
              Address
            </p><p class="font-mono">
              {{ shortenAddress(data.signer?.address) }}
            </p>
          </div><div>
            <p class="text-xs text-[#62789C]">
              Provider
            </p><p>{{ data.signer?.signerProvider || '—' }}</p>
          </div><div>
            <p class="text-xs text-[#62789C]">
              Reconciled
            </p><p>{{ formatDateTime(data.signer?.reconciledAt) }}</p>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>
