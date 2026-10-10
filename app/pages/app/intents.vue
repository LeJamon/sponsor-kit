<script setup lang="ts">
import { formatDateTime, formatDropsAsXrp, shortenAddress } from '~/utils/format'
import { transactionExplorerUrl } from '~/utils/explorer'

definePageMeta({ layout: 'dashboard' })
const search = ref('')
const state = ref('all')
const { data: context } = await useFetch('/api/console/context')
const projectId = computed(() => context.value?.projects?.[0]?.project.publicId)
const { data, status, error, refresh } = await useAsyncData('project-intents', () => projectId.value ? $fetch(`/api/console/projects/${projectId.value}/intents`, { query: { search: search.value || undefined, status: state.value === 'all' ? undefined : state.value } }) : Promise.resolve(null), { watch: [projectId, search, state] })
const displayItems = computed(() => data.value?.items.map(intent => ({ ...intent, explorerUrl: transactionExplorerUrl(intent.network, intent.transactionHash) })) || [])
</script>

<template>
  <div>
    <ConsolePageHeader
      eyebrow="Transactions"
      title="Sponsorship intents"
      description="Every row comes from the durable intent state machine and validated submission records."
    />
    <div class="mb-5 grid gap-3 sm:grid-cols-[1fr_220px_auto]">
      <UInput
        v-model="search"
        icon="i-lucide-search"
        placeholder="Search intent or wallet"
      /><USelect
        v-model="state"
        :items="[{ label: 'All states', value: 'all' }, { label: 'Awaiting wallet', value: 'awaiting_user_signature' }, { label: 'Submitting', value: 'submitting,submitted' }, { label: 'Validated', value: 'validated' }, { label: 'Failed', value: 'failed,rejected,expired,cancelled' }]"
        value-key="value"
      /><UButton
        label="Refresh"
        icon="i-lucide-refresh-cw"
        color="neutral"
        variant="outline"
        :loading="status === 'pending'"
        @click="refresh()"
      />
    </div>
    <UAlert
      v-if="error"
      color="error"
      variant="subtle"
      title="Intents are unavailable"
      :description="error.message"
    />
    <section
      v-else
      class="acme-card overflow-hidden"
    >
      <div
        v-if="status === 'pending' && !data"
        class="p-5"
      >
        <USkeleton class="h-64" />
      </div>
      <div
        v-else-if="displayItems.length"
        class="divide-y divide-[#E9F0FA]"
      >
        <NuxtLink
          v-for="intent in displayItems"
          :key="intent.id"
          :to="`/app/intents/${intent.id}`"
          class="group grid items-center gap-3 px-5 py-4 text-sm transition hover:bg-[#F7FAFF] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#0A3DFF] lg:grid-cols-[1.1fr_1fr_1fr_1fr_auto_auto]"
        >
          <span class="font-mono text-xs">{{ intent.id }}</span><span>{{ shortenAddress(intent.accountAddress) }}</span><span>{{ intent.canonicalTransaction.TransactionType }}</span><span>{{ intent.policy ? `${intent.policy.name} · v${intent.policy.version}` : 'No policy' }}</span><IntentStatus :status="intent.state" /><div class="text-right">
            <p>{{ formatDropsAsXrp(intent.estimatedReserveDrops !== '0' ? intent.estimatedReserveDrops : intent.estimatedFeeDrops) }}</p><p class="text-xs text-[#62789C]">
              {{ formatDateTime(intent.createdAt) }}<UIcon
                name="i-lucide-arrow-up-right"
                class="ml-1 inline size-3.5 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
              />
            </p>
          </div>
        </NuxtLink>
      </div>
      <div
        v-else
        class="px-5 py-14 text-center"
      >
        <p class="font-medium">
          No matching intents
        </p><p class="mt-1 text-sm text-[#62789C]">
          New requests appear here after the backend creates a sponsorship intent.
        </p><UButton
          to="/app/first-payment"
          label="Make your first sponsored payment"
          class="mt-5"
          trailing-icon="i-lucide-arrow-right"
        />
      </div>
    </section>
  </div>
</template>
