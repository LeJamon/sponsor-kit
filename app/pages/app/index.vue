<script setup lang="ts">
import { formatDateTime, formatDropsAsXrp, shortenAddress } from '~/utils/format'

const requestFetch = useRequestFetch()

definePageMeta({ layout: 'dashboard' })
const { data: context } = await useFetch('/api/console/context')
const projectId = computed(() => context.value?.projects?.[0]?.project.publicId)
const { data, status, error, refresh } = await useAsyncData('project-overview', () => projectId.value ? requestFetch(`/api/console/projects/${projectId.value}/overview`) : Promise.resolve(null), { watch: [projectId] })
const { data: readiness, error: readinessError, refresh: refreshReadiness } = await useFetch<{ ready: boolean }>('/api/console/readiness')
</script>

<template>
  <div>
    <ConsolePageHeader
      eyebrow="Developer console"
      :title="data ? `${data.project.name} overview` : 'Project overview'"
      description="Validated Devnet activity, sponsor capacity, and recent intents from the backend."
    >
      <UButton
        to="/app/first-payment"
        label="Make first payment"
        icon="i-lucide-send"
        color="primary"
      />
    </ConsolePageHeader>
    <UAlert
      v-if="!context?.projects?.length"
      color="warning"
      variant="subtle"
      icon="i-lucide-panels-top-left"
      title="Finish setting up your one-project Devnet pilot"
      description="Create the authenticated project and run live network readiness checks before using the sponsorship flow."
    >
      <template #actions>
        <UButton
          to="/app/setup"
          label="Open setup"
          color="warning"
          variant="soft"
        />
      </template>
    </UAlert>
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
      <UAlert
        v-if="readinessError || readiness?.ready === false"
        class="mt-6"
        color="warning"
        variant="subtle"
        icon="i-lucide-triangle-alert"
        title="Sponsorship is waiting on network readiness"
        :description="readinessError?.message || 'One or more live Devnet checks need attention before a new intent can be created.'"
      >
        <template #actions>
          <div class="flex flex-wrap gap-2">
            <UButton
              to="/app/setup"
              label="Review checks"
              color="warning"
              variant="soft"
            /><UButton
              label="Refresh"
              color="warning"
              variant="ghost"
              @click="() => refreshReadiness()"
            />
          </div>
        </template>
      </UAlert>
      <section class="acme-card mt-6 overflow-hidden">
        <div class="flex flex-wrap items-center justify-between gap-4 border-b border-[#D9E5F7] px-5 py-4">
          <div>
            <p class="acme-kicker">
              Self-service pilot
            </p>
            <h2 class="mt-1 font-semibold">
              Make a real sponsored Devnet payment
            </h2>
            <p class="mt-1 text-xs text-[#62789C]">
              Use a disposable browser wallet, review the canonical transaction, and watch validated finality.
            </p>
          </div>
          <UButton
            to="/app/first-payment"
            label="Start guided payment"
            trailing-icon="i-lucide-arrow-right"
          />
        </div>
        <div class="grid gap-3 px-5 py-4 text-sm sm:grid-cols-3">
          <div class="flex items-center gap-2">
            <UIcon
              name="i-lucide-wallet-cards"
              class="size-4 text-[#0A3DFF]"
            /><span>Disposable wallet stays in memory</span>
          </div>
          <div class="flex items-center gap-2">
            <UIcon
              name="i-lucide-file-check-2"
              class="size-4 text-[#0A3DFF]"
            /><span>Exact fields shown before signing</span>
          </div>
          <div class="flex items-center gap-2">
            <UIcon
              name="i-lucide-activity"
              class="size-4 text-[#0A3DFF]"
            /><span>Live finality updates</span>
          </div>
        </div>
      </section>
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
