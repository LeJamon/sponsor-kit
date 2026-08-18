<script setup lang="ts">
import { formatDateTime, formatDropsAsXrp } from '~/utils/format'

definePageMeta({ layout: 'dashboard' })
type PolicyDocument = { allowedTransactionTypes: string[], maximumFeeDrops: string, maximumReserveDrops: string, maximumIntentsPerWalletPerDay: number, intentTtlSeconds: number }
const { data: context } = await useFetch('/api/console/context')
const projectId = computed(() => context.value?.projects?.[0]?.project.publicId)
const { data: policies, status, error, refresh } = await useAsyncData('project-policies', () => projectId.value ? $fetch(`/api/console/projects/${projectId.value}/policies`) : Promise.resolve([]), { watch: [projectId] })
const open = ref(false)
const saving = ref(false)
const mutationError = ref('')
const form = reactive({ name: 'Default sponsorship', transactionTypes: 'Payment, TrustSet, OfferCreate', maximumFeeDrops: '10000', maximumReserveDrops: '1000000', maximumIntentsPerWalletPerDay: 100, intentTtlSeconds: 300 })

async function createPolicy() {
  if (!projectId.value) return
  saving.value = true
  mutationError.value = ''
  try {
    await $fetch(`/api/console/projects/${projectId.value}/policies`, { method: 'POST', body: { name: form.name, activate: true, document: { allowedTransactionTypes: form.transactionTypes.split(',').map(value => value.trim()).filter(Boolean), allowedDestinations: [], allowedFields: [], maximumFeeDrops: form.maximumFeeDrops, maximumReserveDrops: form.maximumReserveDrops, maximumIntentsPerWalletPerDay: Number(form.maximumIntentsPerWalletPerDay), intentTtlSeconds: Number(form.intentTtlSeconds), requireWalletProof: true } } })
    open.value = false
    await refresh()
  } catch (requestError: unknown) {
    mutationError.value = requestError instanceof Error ? requestError.message : 'Policy creation failed.'
  } finally {
    saving.value = false
  }
}

async function changeStatus(policyId: string, nextStatus: 'active' | 'paused' | 'archived') {
  if (!projectId.value) return
  await $fetch(`/api/console/projects/${projectId.value}/policies/${policyId}`, { method: 'PATCH', body: { status: nextStatus } })
  await refresh()
}

function document(policy: { document: Record<string, unknown> }) {
  return policy.document as PolicyDocument
}
</script>

<template>
  <div>
    <ConsolePageHeader
      eyebrow="Risk controls"
      title="Sponsorship policies"
      description="Published policy documents are immutable; changes create a new version and every intent keeps its approved snapshot."
    >
      <UButton
        label="New policy version"
        icon="i-lucide-plus"
        @click="open = !open"
      />
    </ConsolePageHeader>
    <section
      v-if="open"
      class="acme-card mb-6 p-5"
    >
      <h2 class="font-semibold">
        Publish a policy version
      </h2><div class="mt-4 grid gap-4 md:grid-cols-2">
        <UFormField label="Policy name">
          <UInput
            v-model="form.name"
            class="w-full"
          />
        </UFormField><UFormField label="Allowed transaction types">
          <UInput
            v-model="form.transactionTypes"
            class="w-full"
          />
        </UFormField><UFormField label="Maximum fee (drops)">
          <UInput
            v-model="form.maximumFeeDrops"
            class="w-full"
          />
        </UFormField><UFormField label="Maximum reserve (drops)">
          <UInput
            v-model="form.maximumReserveDrops"
            class="w-full"
          />
        </UFormField><UFormField label="Wallet intents per UTC day">
          <UInput
            v-model.number="form.maximumIntentsPerWalletPerDay"
            type="number"
            class="w-full"
          />
        </UFormField><UFormField label="Intent TTL (seconds)">
          <UInput
            v-model.number="form.intentTtlSeconds"
            type="number"
            class="w-full"
          />
        </UFormField>
      </div><UAlert
        v-if="mutationError"
        class="mt-4"
        color="error"
        :description="mutationError"
      /><div class="mt-4">
        <UButton
          label="Publish version"
          :loading="saving"
          @click="createPolicy"
        />
      </div>
    </section>
    <UAlert
      v-if="error"
      color="error"
      title="Policies are unavailable"
      :description="error.message"
    />
    <div
      v-else-if="status === 'pending' && !policies"
      class="grid gap-4"
    >
      <USkeleton
        v-for="index in 3"
        :key="index"
        class="h-40 rounded-2xl"
      />
    </div>
    <div
      v-else-if="policies?.length"
      class="grid gap-4"
    >
      <section
        v-for="policy in policies"
        :key="policy.id"
        class="acme-card p-5"
      >
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div class="flex items-center gap-2">
              <h2 class="font-semibold">
                {{ policy.name }}
              </h2><UBadge
                :label="`v${policy.version}`"
                color="neutral"
                variant="subtle"
              /><UBadge
                :label="policy.status"
                :color="policy.status === 'active' ? 'success' : policy.status === 'paused' ? 'warning' : 'neutral'"
                variant="subtle"
              />
            </div><p class="mt-1 text-xs text-[#62789C]">
              Hash {{ policy.documentHash.slice(0, 12) }}… · published {{ formatDateTime(policy.publishedAt) }}
            </p>
          </div><div class="flex gap-2">
            <UButton
              v-if="policy.status === 'active'"
              label="Pause"
              color="warning"
              variant="soft"
              @click="changeStatus(policy.id, 'paused')"
            /><UButton
              v-else-if="policy.status !== 'archived'"
              label="Activate"
              color="success"
              variant="soft"
              @click="changeStatus(policy.id, 'active')"
            /><UButton
              v-if="policy.status !== 'archived'"
              label="Archive"
              color="neutral"
              variant="ghost"
              @click="changeStatus(policy.id, 'archived')"
            />
          </div>
        </div><div class="mt-4 grid gap-3 text-sm md:grid-cols-4">
          <div>
            <p class="text-xs text-[#62789C]">
              Operations
            </p><p>{{ document(policy).allowedTransactionTypes.join(', ') }}</p>
          </div><div>
            <p class="text-xs text-[#62789C]">
              Fee cap
            </p><p>{{ document(policy).maximumFeeDrops }} drops</p>
          </div><div>
            <p class="text-xs text-[#62789C]">
              Reserve cap
            </p><p>{{ formatDropsAsXrp(document(policy).maximumReserveDrops) }}</p>
          </div><div>
            <p class="text-xs text-[#62789C]">
              Rate / TTL
            </p><p>{{ document(policy).maximumIntentsPerWalletPerDay }} daily · {{ document(policy).intentTtlSeconds }}s</p>
          </div>
        </div>
      </section>
    </div>
    <section
      v-else
      class="acme-card px-5 py-14 text-center"
    >
      <p class="font-medium">
        No sponsorship policies
      </p><p class="mt-1 text-sm text-[#62789C]">
        Publish one before accepting intents.
      </p>
    </section>
  </div>
</template>
