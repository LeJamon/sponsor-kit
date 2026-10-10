<script setup lang="ts">
import { formatDateTime, formatDropsAsXrp } from '~/utils/format'

const requestFetch = useRequestFetch()

definePageMeta({ layout: 'dashboard' })
type FundingData = {
  sponsor: { address: string, signerKeyReference: string, observedBalanceDrops: string, ledgerIndex: number, reconciledAt: string }
  balance: { availableDrops: string, pendingFeeDrops: string, pendingReserveDrops: string, lockedReserveDrops: string }
  limits?: { feeBudgetDrops: string, reserveBudgetDrops: string, walletFeeQuotaDrops: string, walletReserveQuotaDrops: string, quotaPeriodSeconds: number }
  usage?: { feeReservedDrops: string, feeSpentDrops: string, reserveReservedDrops: string, reserveExposureDrops: string }
  entries: Array<{ id: string, type: string, intentId?: string | null, feeDrops: string, reserveDrops: string, createdAt: string }>
}
const { data: context } = await useFetch('/api/console/context')
const projectId = computed(() => context.value?.projects?.[0]?.project.publicId)
const { data, status, error, refresh } = await useAsyncData<FundingData | null>('project-funding', () => projectId.value ? requestFetch(`/api/console/projects/${projectId.value}/funding`) : Promise.resolve(null), { watch: [projectId] })
const copied = ref(false)
const budgetOpen = ref(false)
const budgetSaving = ref(false)
const budgetError = ref('')
const budgetForm = reactive({ feeBudgetDrops: '', reserveBudgetDrops: '', walletFeeQuotaDrops: '', walletReserveQuotaDrops: '', quotaPeriodSeconds: 86_400 })
const canManageBudget = computed(() => ['owner', 'admin'].includes(context.value?.projects?.[0]?.role || ''))

watch(data, (value) => {
  if (!value?.limits) return
  budgetForm.feeBudgetDrops = value.limits.feeBudgetDrops
  budgetForm.reserveBudgetDrops = value.limits.reserveBudgetDrops
  budgetForm.walletFeeQuotaDrops = value.limits.walletFeeQuotaDrops
  budgetForm.walletReserveQuotaDrops = value.limits.walletReserveQuotaDrops
  budgetForm.quotaPeriodSeconds = value.limits.quotaPeriodSeconds
}, { immediate: true })
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

async function saveBudget() {
  if (!projectId.value) return
  budgetSaving.value = true
  budgetError.value = ''
  try {
    await $fetch(`/api/console/projects/${projectId.value}/funding/budget`, {
      method: 'PUT' as never,
      body: {
        feeBudgetDrops: budgetForm.feeBudgetDrops,
        reserveBudgetDrops: budgetForm.reserveBudgetDrops,
        walletFeeQuotaDrops: budgetForm.walletFeeQuotaDrops,
        walletReserveQuotaDrops: budgetForm.walletReserveQuotaDrops,
        quotaPeriodSeconds: Number(budgetForm.quotaPeriodSeconds)
      }
    })
    budgetOpen.value = false
    await refresh()
  } catch (requestError: unknown) {
    budgetError.value = requestError instanceof Error ? requestError.message : 'Funding budget could not be updated.'
  } finally {
    budgetSaving.value = false
  }
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
      <section
        v-if="data.limits"
        class="acme-card mt-6 p-5 sm:p-6"
      >
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p class="acme-kicker">
              Sponsorship guardrails
            </p>
            <h2 class="mt-1 font-semibold">
              Project funding limits
            </h2>
            <p class="mt-1 max-w-2xl text-sm text-[#62789C]">
              Limits are measured in drops. They keep Devnet sponsorship predictable while the usage figures below show the current reserved and spent amounts.
            </p>
          </div>
          <UButton
            v-if="canManageBudget"
            :label="budgetOpen ? 'Close editor' : 'Edit limits'"
            :icon="budgetOpen ? 'i-lucide-x' : 'i-lucide-sliders-horizontal'"
            color="neutral"
            variant="outline"
            @click="budgetOpen = !budgetOpen"
          />
        </div>
        <div class="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div class="rounded-xl bg-[#F4F8FE] p-4">
            <p class="text-xs text-[#62789C]">
              Fee budget
            </p><p class="mt-1 font-semibold">
              {{ formatDropsAsXrp(data.limits.feeBudgetDrops) }}
            </p>
          </div>
          <div class="rounded-xl bg-[#F4F8FE] p-4">
            <p class="text-xs text-[#62789C]">
              Reserve budget
            </p><p class="mt-1 font-semibold">
              {{ formatDropsAsXrp(data.limits.reserveBudgetDrops) }}
            </p>
          </div>
          <div class="rounded-xl bg-[#F4F8FE] p-4">
            <p class="text-xs text-[#62789C]">
              Wallet fee quota
            </p><p class="mt-1 font-semibold">
              {{ formatDropsAsXrp(data.limits.walletFeeQuotaDrops) }}
            </p>
          </div>
          <div class="rounded-xl bg-[#F4F8FE] p-4">
            <p class="text-xs text-[#62789C]">
              Wallet reserve quota
            </p><p class="mt-1 font-semibold">
              {{ formatDropsAsXrp(data.limits.walletReserveQuotaDrops) }}
            </p>
          </div>
        </div>
        <dl class="mt-5 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          <div class="flex justify-between gap-4 border-b border-[#E9F0FA] pb-2">
            <dt class="text-[#62789C]">
              Fee reserved
            </dt><dd class="font-medium">
              {{ formatDropsAsXrp(data.usage?.feeReservedDrops) }}
            </dd>
          </div>
          <div class="flex justify-between gap-4 border-b border-[#E9F0FA] pb-2">
            <dt class="text-[#62789C]">
              Fee spent
            </dt><dd class="font-medium">
              {{ formatDropsAsXrp(data.usage?.feeSpentDrops) }}
            </dd>
          </div>
          <div class="flex justify-between gap-4 border-b border-[#E9F0FA] pb-2">
            <dt class="text-[#62789C]">
              Reserve reserved
            </dt><dd class="font-medium">
              {{ formatDropsAsXrp(data.usage?.reserveReservedDrops) }}
            </dd>
          </div>
          <div class="flex justify-between gap-4 border-b border-[#E9F0FA] pb-2">
            <dt class="text-[#62789C]">
              Reserve exposure
            </dt><dd class="font-medium">
              {{ formatDropsAsXrp(data.usage?.reserveExposureDrops) }}
            </dd>
          </div>
          <div class="flex justify-between gap-4 sm:col-span-2">
            <dt class="text-[#62789C]">
              Quota period
            </dt><dd class="font-medium">
              {{ Math.round(data.limits.quotaPeriodSeconds / 3600) }} hours
            </dd>
          </div>
        </dl>
        <form
          v-if="budgetOpen && canManageBudget"
          class="mt-6 border-t border-[#D9E5F7] pt-5"
          @submit.prevent="saveBudget"
        >
          <div class="grid gap-4 sm:grid-cols-2">
            <UFormField label="Fee budget (drops)">
              <UInput
                v-model="budgetForm.feeBudgetDrops"
                inputmode="numeric"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Reserve budget (drops)">
              <UInput
                v-model="budgetForm.reserveBudgetDrops"
                inputmode="numeric"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Wallet fee quota (drops)">
              <UInput
                v-model="budgetForm.walletFeeQuotaDrops"
                inputmode="numeric"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Wallet reserve quota (drops)">
              <UInput
                v-model="budgetForm.walletReserveQuotaDrops"
                inputmode="numeric"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Quota period (seconds)">
              <UInput
                v-model.number="budgetForm.quotaPeriodSeconds"
                type="number"
                min="60"
                class="w-full"
              />
            </UFormField>
          </div>
          <UAlert
            v-if="budgetError"
            class="mt-4"
            color="error"
            variant="subtle"
            title="Could not update funding limits"
            :description="budgetError"
          />
          <div class="mt-4 flex flex-wrap gap-2">
            <UButton
              type="submit"
              label="Save limits"
              icon="i-lucide-save"
              :loading="budgetSaving"
            />
            <UButton
              type="button"
              label="Cancel"
              color="neutral"
              variant="ghost"
              @click="budgetOpen = false"
            />
          </div>
        </form>
      </section>
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
