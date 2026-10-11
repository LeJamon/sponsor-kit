<script setup lang="ts">
import type { PolicyForm } from '~/utils/policy'

const props = withDefaults(defineProps<{
  modelValue: PolicyForm
  transactionTypeOptions: string[]
  disabled?: boolean
}>(), { disabled: false })

const emit = defineEmits<{
  'update:modelValue': [value: PolicyForm]
}>()

const sections = [
  { id: 'fees-reserves', label: 'Fees & reserves' },
  { id: 'transactions', label: 'Transactions' },
  { id: 'access', label: 'Access' },
  { id: 'settings', label: 'Settings' }
]
const activeSection = ref(sections[0]?.id || 'fees-reserves')
const tabRefs = ref<Record<string, HTMLElement | null>>({})

function update<K extends keyof PolicyForm>(key: K, value: PolicyForm[K]) {
  emit('update:modelValue', { ...props.modelValue, [key]: value })
}

function toggleTransactionType(transactionType: string, checked: boolean) {
  const transactionTypes = checked
    ? [...new Set([...props.modelValue.transactionTypes, transactionType])]
    : props.modelValue.transactionTypes.filter(item => item !== transactionType)
  update('transactionTypes', transactionTypes)
}

function setTabRef(id: string, element: unknown) {
  const candidate = element && typeof element === 'object' && '$el' in element
    ? (element as { $el?: unknown }).$el
    : element
  tabRefs.value[id] = typeof HTMLElement !== 'undefined' && candidate instanceof HTMLElement ? candidate : null
}

function selectSection(id: string, focus = false) {
  activeSection.value = id
  if (focus) nextTick(() => tabRefs.value[id]?.focus())
}

function onTabKeydown(event: KeyboardEvent, index: number) {
  let nextIndex: number | undefined
  if (event.key === 'ArrowRight') nextIndex = (index + 1) % sections.length
  if (event.key === 'ArrowLeft') nextIndex = (index - 1 + sections.length) % sections.length
  if (event.key === 'Home') nextIndex = 0
  if (event.key === 'End') nextIndex = sections.length - 1
  if (nextIndex === undefined) return
  event.preventDefault()
  const nextSection = sections[nextIndex]
  if (nextSection) selectSection(nextSection.id, true)
}
</script>

<template>
  <div class="overflow-hidden rounded-2xl border border-[#D9E5F7] bg-white">
    <div
      role="tablist"
      aria-label="Policy sections"
      class="flex gap-1 overflow-x-auto border-b border-[#D9E5F7] bg-[#F7FAFF] p-2"
    >
      <button
        v-for="section in sections"
        :id="`${section.id}-tab`"
        :key="section.id"
        :ref="element => setTabRef(section.id, element)"
        type="button"
        role="tab"
        :aria-selected="activeSection === section.id"
        :aria-controls="section.id"
        :tabindex="activeSection === section.id ? 0 : -1"
        class="shrink-0 rounded-lg px-3 py-2 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-[#0A3DFF]"
        :class="activeSection === section.id ? 'bg-white text-[#0A3DFF] shadow-sm' : 'text-[#62789C] hover:bg-white hover:text-[#10244A]'"
        @click="selectSection(section.id)"
        @keydown="onTabKeydown($event, sections.indexOf(section))"
      >
        {{ section.label }}
      </button>
    </div>

    <section
      v-if="activeSection === 'fees-reserves'"
      id="fees-reserves"
      role="tabpanel"
      aria-labelledby="fees-reserves-tab"
      aria-label="Fees and reserves"
      :aria-hidden="activeSection !== 'fees-reserves'"
      class="scroll-mt-6 border-b border-[#D9E5F7] p-5 sm:p-6"
    >
      <h2 class="font-semibold">
        Fees & reserves
      </h2>
      <div class="mt-5 divide-y divide-[#E9F0FA]">
        <div class="grid gap-2 py-4 first:pt-0 sm:grid-cols-[minmax(0,1fr)_minmax(13rem,20rem)] sm:items-center sm:gap-6">
          <div>
            <label
              for="maximum-fee-xrp"
              class="text-sm font-medium"
            >Maximum fee</label>
            <p class="mt-1 text-xs text-[#62789C]">
              Per sponsored transaction.
            </p>
          </div>
          <UInput
            id="maximum-fee-xrp"
            :model-value="modelValue.maximumFeeXrp"
            inputmode="decimal"
            placeholder="0.01"
            :disabled="disabled"
            class="w-full"
            @update:model-value="value => update('maximumFeeXrp', value)"
          >
            <template #trailing>
              <span class="text-xs text-[#62789C]">XRP</span>
            </template>
          </UInput>
        </div>
        <div class="grid gap-2 py-4 sm:grid-cols-[minmax(0,1fr)_minmax(13rem,20rem)] sm:items-center sm:gap-6">
          <div>
            <label
              for="maximum-reserve-xrp"
              class="text-sm font-medium"
            >Maximum reserve</label>
            <p class="mt-1 text-xs text-[#62789C]">
              Per sponsored transaction.
            </p>
          </div>
          <UInput
            id="maximum-reserve-xrp"
            :model-value="modelValue.maximumReserveXrp"
            inputmode="decimal"
            placeholder="1"
            :disabled="disabled"
            class="w-full"
            @update:model-value="value => update('maximumReserveXrp', value)"
          >
            <template #trailing>
              <span class="text-xs text-[#62789C]">XRP</span>
            </template>
          </UInput>
        </div>
      </div>
    </section>

    <section
      v-if="activeSection === 'transactions'"
      id="transactions"
      role="tabpanel"
      aria-labelledby="transactions-tab"
      aria-label="Transactions"
      :aria-hidden="activeSection !== 'transactions'"
      class="scroll-mt-6 border-b border-[#D9E5F7] p-5 sm:p-6"
    >
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 class="font-semibold">
            Transactions
          </h2>
          <p class="mt-1 text-xs text-[#62789C]">
            Select the transaction types this policy accepts.
          </p>
        </div>
        <span class="text-xs text-[#62789C]">
          {{ modelValue.transactionTypes.length }} selected
        </span>
      </div>
      <div
        v-if="transactionTypeOptions.length"
        class="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-3"
      >
        <label
          v-for="transactionType in transactionTypeOptions"
          :key="transactionType"
          class="flex min-w-0 items-center gap-3 rounded-xl border border-[#D9E5F7] px-3 py-2.5 text-sm transition has-[:checked]:border-[#8BC3FF] has-[:checked]:bg-[#F7FAFF]"
          :class="disabled ? 'opacity-60' : 'cursor-pointer hover:border-[#8BC3FF]'"
        >
          <UCheckbox
            :model-value="modelValue.transactionTypes.includes(transactionType)"
            :disabled="disabled"
            :aria-label="`Allow ${transactionType}`"
            @update:model-value="value => toggleTransactionType(transactionType, Boolean(value))"
          />
          <span class="truncate">{{ transactionType }}</span>
        </label>
      </div>
      <UAlert
        v-else
        class="mt-5"
        color="warning"
        variant="subtle"
        title="Transaction types are unavailable"
        description="Refresh the project before publishing a policy."
      />
    </section>

    <section
      v-if="activeSection === 'access'"
      id="access"
      role="tabpanel"
      aria-labelledby="access-tab"
      aria-label="Access"
      :aria-hidden="activeSection !== 'access'"
      class="scroll-mt-6 border-b border-[#D9E5F7] p-5 sm:p-6"
    >
      <h2 class="font-semibold">
        Access
      </h2>
      <div class="mt-5 grid gap-5 lg:grid-cols-2">
        <UFormField
          label="Allowed destinations"
          help="Optional. One classic XRPL address per line."
        >
          <UTextarea
            :model-value="modelValue.allowedDestinations"
            :rows="5"
            :disabled="disabled"
            placeholder="r…"
            class="w-full"
            @update:model-value="value => update('allowedDestinations', value)"
          />
        </UFormField>
        <UFormField
          label="Allowed fields"
          help="Optional. One transaction field per line."
        >
          <UTextarea
            :model-value="modelValue.allowedFields"
            :rows="5"
            :disabled="disabled"
            placeholder="Destination&#10;Amount"
            class="w-full"
            @update:model-value="value => update('allowedFields', value)"
          />
        </UFormField>
      </div>
    </section>

    <section
      v-if="activeSection === 'settings'"
      id="settings"
      role="tabpanel"
      aria-labelledby="settings-tab"
      aria-label="Settings"
      :aria-hidden="activeSection !== 'settings'"
      class="scroll-mt-6 p-5 sm:p-6"
    >
      <h2 class="font-semibold">
        Settings
      </h2>
      <div class="mt-5 divide-y divide-[#E9F0FA]">
        <div class="grid gap-2 py-4 first:pt-0 sm:grid-cols-[minmax(0,1fr)_minmax(13rem,20rem)] sm:items-center sm:gap-6">
          <div>
            <label
              for="daily-intents"
              class="text-sm font-medium"
            >Wallet intents per UTC day</label>
            <p class="mt-1 text-xs text-[#62789C]">
              Maximum new intents for one wallet.
            </p>
          </div>
          <UInput
            id="daily-intents"
            :model-value="modelValue.maximumIntentsPerWalletPerDay"
            type="number"
            min="1"
            step="1"
            :disabled="disabled"
            class="w-full"
            @update:model-value="value => update('maximumIntentsPerWalletPerDay', value)"
          />
        </div>
        <div class="grid gap-2 py-4 sm:grid-cols-[minmax(0,1fr)_minmax(13rem,20rem)] sm:items-center sm:gap-6">
          <div>
            <label
              for="intent-ttl"
              class="text-sm font-medium"
            >Intent TTL</label>
            <p class="mt-1 text-xs text-[#62789C]">
              How long a wallet has to sign, from 30 to 900 seconds.
            </p>
          </div>
          <UInput
            id="intent-ttl"
            :model-value="modelValue.intentTtlSeconds"
            type="number"
            min="30"
            max="900"
            step="1"
            :disabled="disabled"
            class="w-full"
            @update:model-value="value => update('intentTtlSeconds', value)"
          >
            <template #trailing>
              <span class="text-xs text-[#62789C]">sec</span>
            </template>
          </UInput>
        </div>
        <div class="flex flex-wrap items-center justify-between gap-4 py-4 last:pb-0">
          <div>
            <p class="text-sm font-medium">
              Wallet proof
            </p>
            <p class="mt-1 text-xs text-[#62789C]">
              Required by the signing flow.
            </p>
          </div>
          <UCheckbox
            :model-value="true"
            label="Required"
            disabled
          />
        </div>
      </div>
    </section>
  </div>
</template>
