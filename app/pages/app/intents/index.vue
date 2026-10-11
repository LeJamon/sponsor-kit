<script setup lang="ts">
const requestFetch = useRequestFetch()
definePageMeta({ layout: 'dashboard' })
const search = ref('')
const state = ref('all')
const cursors = ref<string[]>([])
const cursor = computed(() => cursors.value.at(-1))
const { projectId } = await useConsoleProject()
watch([search, state], () => {
  cursors.value = []
}, { flush: 'sync' })
const { data, status, error, refresh } = await useAsyncData(`project-intents-${projectId.value}`, () => projectId.value ? requestFetch(`/api/console/projects/${projectId.value}/intents`, { query: { search: search.value || undefined, status: state.value === 'all' ? undefined : state.value, cursor: cursor.value } }) : Promise.resolve(null), { watch: [projectId, search, state, cursor] })
</script>

<template>
  <div>
    <ConsolePageHeader title="Transactions">
      <UButton
        to="/docs"
        label="API docs"
        icon="i-lucide-book-open"
        color="neutral"
        variant="outline"
      />
    </ConsolePageHeader>
    <div class="mb-5 grid gap-3 sm:grid-cols-[1fr_220px_auto]">
      <UInput
        v-model="search"
        icon="i-lucide-search"
        placeholder="Search ID or wallet"
        aria-label="Search transactions"
      />
      <USelect
        v-model="state"
        aria-label="Transaction status"
        :items="[{ label: 'All statuses', value: 'all' }, { label: 'Awaiting wallet', value: 'awaiting_user_signature' }, { label: 'Submitting', value: 'submitting,submitted' }, { label: 'Validated', value: 'validated' }, { label: 'Failed', value: 'failed,rejected,expired,cancelled' }]"
      />
      <UButton
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
      title="Could not load transactions"
      :description="error.message"
    />
    <section
      v-else
      class="acme-card overflow-hidden"
      :aria-busy="status === 'pending'"
    >
      <div
        v-if="status === 'pending' && !data"
        class="p-5"
      >
        <USkeleton class="h-64" />
      </div>
      <TransactionTable
        v-else-if="data?.items.length"
        :items="data.items"
      />
      <div
        v-else
        class="px-5 py-16 text-center text-sm text-[#62789C]"
      >
        {{ search || state !== 'all' ? 'No matching transactions' : 'No transactions yet' }}
      </div>
      <div
        v-if="data?.nextCursor || cursors.length"
        class="flex items-center justify-end gap-2 border-t border-[#E2E8F0] px-5 py-3"
      >
        <UButton
          label="Newer"
          icon="i-lucide-chevron-left"
          color="neutral"
          variant="outline"
          :disabled="!cursors.length || status === 'pending'"
          @click="cursors.pop()"
        />
        <UButton
          label="Older"
          trailing-icon="i-lucide-chevron-right"
          color="neutral"
          variant="outline"
          :disabled="!data?.nextCursor || status === 'pending'"
          @click="data?.nextCursor && cursors.push(data.nextCursor)"
        />
      </div>
    </section>
  </div>
</template>
