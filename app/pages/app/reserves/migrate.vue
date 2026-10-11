<script setup lang="ts">
import { formatDropsAsXrp } from '~/utils/format'

definePageMeta({ layout: 'dashboard' })
type Target = { id: string, targetKey: string, objectId: string | null, objectType: string, classification: string, state: string, estimatedReserveDrops: string, reason?: string, observedSponsor?: string | null, intent: { id: string, state: string, transactionHash: string | null, ledgerIndex: number | null } | null }
type Plan = { id: string, accountAddress: string, definitionsHash: string, inspectionLedgerIndex: number, inspectionLedgerHash: string, expiresAt: string, state?: string, version?: number, targets: Target[] }
type PreparedIntent = { id: string, state: string, transaction: Record<string, unknown>, grant: string, expiresAt: string, definitionsHash: string }

const route = useRoute()
const router = useRouter()
const { projectId } = await useConsoleProject()
const address = ref('')
const plan = ref<Plan | null>(null)
const selected = ref<string[]>([])
const activeIntent = ref<PreparedIntent | null>(null)
const signedBlob = ref('')
const busy = ref(false)
const errorMessage = ref('')
const authorizeResult = ref<{ state: string, transactionHash: string } | null>(null)
const savedPlans = ref<Plan[]>([])
const loadingSavedPlans = ref(false)
const savedPlansError = ref('')
const eligible = computed(() => plan.value?.targets.filter(target => target.classification === 'eligible') || [])
const selectedReserve = computed(() => eligible.value.filter(target => selected.value.includes(target.id)).reduce((total, target) => total + BigInt(target.estimatedReserveDrops), 0n))
const activeState = computed(() => plan.value?.targets.find(target => target.intent?.id === activeIntent.value?.id)?.intent?.state)
const activeTerminal = computed(() => ['validated', 'failed', 'expired'].includes(activeState.value || ''))

function message(error: unknown, fallback: string) {
  return error && typeof error === 'object' && 'data' in error && typeof error.data === 'object' && error.data && 'statusMessage' in error.data
    ? String(error.data.statusMessage)
    : error instanceof Error ? error.message : fallback
}

function statusCode(error: unknown) {
  if (!error || typeof error !== 'object') return undefined
  if ('statusCode' in error && typeof error.statusCode === 'number') return error.statusCode
  if ('status' in error && typeof error.status === 'number') return error.status
  if ('response' in error && error.response && typeof error.response === 'object' && 'status' in error.response && typeof error.response.status === 'number') return error.response.status
  return undefined
}

async function loadPlan() {
  if (!projectId.value || !plan.value) return
  plan.value = await $fetch(`/api/console/projects/${projectId.value}/reserve-migration-plans/${plan.value.id}`)
}

async function loadSavedPlans() {
  if (!projectId.value) return
  loadingSavedPlans.value = true
  savedPlansError.value = ''
  try {
    const result = await $fetch<{ plans: Plan[] }>(`/api/console/projects/${projectId.value}/reserve-migration-plans`)
    savedPlans.value = result.plans || []
  } catch (error: unknown) {
    savedPlansError.value = message(error, 'Saved migration plans are unavailable.')
  } finally {
    loadingSavedPlans.value = false
  }
}

async function openPlan(planId: string) {
  if (!projectId.value) return
  busy.value = true
  errorMessage.value = ''
  try {
    plan.value = await $fetch(`/api/console/projects/${projectId.value}/reserve-migration-plans/${planId}`)
    selected.value = eligible.value.filter(target => !target.intent).map(target => target.id)
    activeIntent.value = null
    signedBlob.value = ''
    authorizeResult.value = null
    await router.replace({ query: { plan: planId } })
  } catch (error: unknown) {
    errorMessage.value = message(error, 'The saved migration plan could not be opened.')
  } finally {
    busy.value = false
  }
}

async function inspect() {
  if (!projectId.value) return
  busy.value = true
  errorMessage.value = ''
  try {
    const created = await $fetch(`/api/console/projects/${projectId.value}/reserve-migration-plans`, { method: 'POST', body: { account: address.value.trim() } })
    plan.value = { id: created.id } as Plan
    await loadPlan()
    selected.value = eligible.value.map(target => target.id)
    activeIntent.value = null
    signedBlob.value = ''
    await router.replace({ query: { plan: plan.value.id } })
    await loadSavedPlans()
  } catch (error: unknown) {
    errorMessage.value = message(error, 'Reserve inspection failed.')
  } finally {
    busy.value = false
  }
}

async function prepare(target: Target) {
  if (!projectId.value || !plan.value) return
  busy.value = true
  errorMessage.value = ''
  try {
    activeIntent.value = await $fetch(`/api/console/projects/${projectId.value}/reserve-migration-plans/${plan.value.id}/targets/${target.id}/intent`, { method: 'POST' })
    signedBlob.value = ''
    authorizeResult.value = null
    await loadPlan()
    await router.replace({ query: { plan: plan.value.id, target: target.id } })
  } catch (error: unknown) {
    errorMessage.value = message(error, 'Transfer preparation failed.')
  } finally {
    busy.value = false
  }
}

async function resumeTarget(target: Target) {
  if (!projectId.value || !target.intent || !plan.value) return
  busy.value = true
  errorMessage.value = ''
  try {
    activeIntent.value = await $fetch(`/api/console/projects/${projectId.value}/intents/${target.intent.id}/signing-package`, { method: 'POST' as never })
    signedBlob.value = ''
    authorizeResult.value = null
    await router.replace({ query: { plan: plan.value.id, target: target.id } })
  } catch (error: unknown) {
    errorMessage.value = message(error, 'This signing package expired. Inspect the wallet again to prepare a fresh transfer.')
  } finally {
    busy.value = false
  }
}

async function authorize() {
  if (!activeIntent.value || !signedBlob.value.trim()) return
  busy.value = true
  errorMessage.value = ''
  try {
    authorizeResult.value = await $fetch(`/api/v1/intents/${activeIntent.value.id}/authorize`, { method: 'POST', body: { grant: activeIntent.value.grant, signedTransaction: signedBlob.value.trim() } })
    await loadPlan()
  } catch (error: unknown) {
    const status = statusCode(error)
    const outcomeUnknown = status === undefined || status === 408 || status === 409 || (status >= 500 && status <= 599)
    if (outcomeUnknown) {
      errorMessage.value = 'The authorization outcome is unknown. Refresh the plan before retrying this exact signed transfer.'
      await loadPlan()
    } else {
      errorMessage.value = message(error, 'Signed transfer authorization failed.')
    }
  } finally {
    busy.value = false
  }
}

async function copyTransaction() {
  if (activeIntent.value) await navigator.clipboard.writeText(JSON.stringify(activeIntent.value.transaction, null, 2))
}

function continueQueue() {
  activeIntent.value = null
  authorizeResult.value = null
  signedBlob.value = ''
  if (plan.value) void router.replace({ query: { plan: plan.value.id } })
}

let poll: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  void loadSavedPlans()
  const routePlanId = typeof route.query.plan === 'string' ? route.query.plan : undefined
  if (routePlanId) void openPlan(routePlanId)
  poll = setInterval(() => {
    if (plan.value && activeIntent.value) void loadPlan()
  }, 4_000)
})
onUnmounted(() => {
  if (poll) clearInterval(poll)
})
</script>

<template>
  <div>
    <ConsolePageHeader
      eyebrow="Existing wallets"
      title="Reserve migration"
      description="Create durable, ledger-pinned plans and move one account or object reserve at a time with real SponsorshipTransfer transactions."
    />
    <UAlert
      class="mb-6"
      color="primary"
      variant="subtle"
      icon="i-lucide-shield-check"
      title="Wallet ownership is proven by the transaction signature"
      description="ACME never requests a seed. Your wallet signs each exact transfer first; the sponsor verifies and co-signs it without changing signed fields."
    />
    <UAlert
      v-if="errorMessage"
      class="mb-6"
      color="error"
      variant="subtle"
      title="Migration action failed"
      :description="errorMessage"
    />

    <section
      v-if="!plan"
      class="acme-card mx-auto max-w-2xl p-7"
    >
      <h2 class="text-xl font-semibold">
        Inspect a Devnet wallet
      </h2><p class="mt-2 text-sm leading-6 text-[#62789C]">
        Account and owner objects are read from one validated ledger and persisted so changes can be detected before signing.
      </p><UFormField
        label="XRPL address"
        help="Devnet · read-only until the wallet signs a transfer"
        class="mt-6"
      >
        <UInput
          v-model="address"
          class="w-full"
          size="lg"
          placeholder="r…"
          icon="i-lucide-search"
        />
      </UFormField><div class="mt-6 flex justify-end">
        <UButton
          label="Inspect validated ledger"
          trailing-icon="i-lucide-arrow-right"
          :loading="busy"
          :disabled="address.trim().length < 25"
          @click="inspect"
        />
      </div>
    </section>

    <section
      v-if="!plan"
      class="acme-card mx-auto mt-6 max-w-2xl overflow-hidden"
    >
      <div class="flex flex-wrap items-center justify-between gap-3 border-b border-[#D9E5F7] px-5 py-4">
        <div>
          <h2 class="font-semibold">
            Saved migration plans
          </h2>
          <p class="mt-1 text-xs text-[#62789C]">
            Plans are pinned to a validated ledger and can be reopened after navigation or a reload.
          </p>
        </div>
        <UButton
          label="Refresh saved plans"
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="ghost"
          :loading="loadingSavedPlans"
          @click="loadSavedPlans"
        />
      </div>
      <UAlert
        v-if="savedPlansError"
        class="m-5"
        color="error"
        variant="subtle"
        title="Saved plans are unavailable"
        :description="savedPlansError"
      />
      <div
        v-else-if="loadingSavedPlans && !savedPlans.length"
        class="space-y-3 p-5"
      >
        <USkeleton
          v-for="index in 2"
          :key="index"
          class="h-16 rounded-xl"
        />
      </div>
      <div
        v-else-if="savedPlans.length"
        class="divide-y divide-[#E9F0FA]"
      >
        <div
          v-for="savedPlan in savedPlans"
          :key="savedPlan.id"
          class="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
        >
          <div class="min-w-0">
            <p class="break-all font-mono text-xs">
              {{ savedPlan.accountAddress }}
            </p>
            <p class="mt-1 text-xs text-[#62789C]">
              Ledger {{ savedPlan.inspectionLedgerIndex.toLocaleString() }} · expires {{ new Date(savedPlan.expiresAt).toLocaleString() }}
            </p>
          </div>
          <UButton
            label="Resume plan"
            icon="i-lucide-rotate-ccw"
            color="neutral"
            variant="outline"
            :loading="busy"
            @click="openPlan(savedPlan.id)"
          />
        </div>
      </div>
      <p
        v-else
        class="px-5 py-8 text-center text-sm text-[#62789C]"
      >
        No saved plans yet. Inspect a Devnet wallet above to create one.
      </p>
    </section>

    <template v-else>
      <section class="acme-card mb-5 p-5 sm:flex sm:items-center sm:justify-between">
        <div>
          <p class="text-xs font-medium text-[#62789C]">
            PINNED DEVNET WALLET
          </p><p class="mt-1 break-all font-mono text-sm font-semibold">
            {{ plan.accountAddress }}
          </p>
        </div><div class="mt-3 flex flex-wrap gap-2 sm:mt-0">
          <UBadge
            :label="`Ledger ${plan.inspectionLedgerIndex.toLocaleString()}`"
            color="success"
            variant="subtle"
          /><UBadge
            :label="`${eligible.length} eligible`"
            color="primary"
            variant="subtle"
          />
        </div>
      </section>

      <section class="acme-card overflow-hidden">
        <div class="border-b border-[#D9E5F7] px-5 py-4">
          <h2 class="font-semibold">
            Reserve inventory
          </h2><p class="mt-1 text-xs text-[#62789C]">
            Ledger {{ plan.inspectionLedgerHash.slice(0, 12) }}… · definitions {{ plan.definitionsHash.slice(0, 12) }}…
          </p>
        </div><div class="divide-y divide-[#E9F0FA]">
          <label
            v-for="target in plan.targets"
            :key="target.id"
            class="flex items-center gap-4 px-5 py-4"
            :class="target.classification === 'eligible' && !target.intent ? 'cursor-pointer hover:bg-[#F7FAFF]' : 'opacity-70'"
          ><UCheckbox
            v-model="selected"
            :value="target.id"
            :disabled="target.classification !== 'eligible' || Boolean(target.intent)"
          /><div class="min-w-0 flex-1">
            <p class="font-medium">{{ target.objectType }}</p><p class="truncate font-mono text-xs text-[#62789C]">{{ target.objectId || 'Account reserve' }}</p><p
              v-if="target.reason"
              class="mt-1 text-xs text-[#62789C]"
            >{{ target.reason }}</p>
          </div><span class="hidden text-sm sm:block">{{ formatDropsAsXrp(target.estimatedReserveDrops) }}</span><IntentStatus
            v-if="target.intent"
            :status="target.intent.state"
          /><UButton
            v-if="target.intent?.state === 'awaiting_user_signature'"
            label="Resume signing"
            size="xs"
            color="neutral"
            variant="outline"
            :loading="busy"
            @click.prevent="resumeTarget(target)"
          /><UBadge
            v-else
            :label="target.classification.replace('_', ' ')"
            :color="target.classification === 'eligible' ? 'primary' : target.classification === 'already_sponsored' ? 'success' : 'neutral'"
            variant="subtle"
          /></label>
        </div>
      </section>

      <div class="my-5 flex flex-wrap items-center justify-between gap-3">
        <UButton
          label="Inspect another wallet"
          color="neutral"
          variant="ghost"
          @click="plan = null; activeIntent = null; void router.replace({ query: {} })"
        /><p class="text-sm text-[#62789C]">
          {{ selected.length }} selected · {{ formatDropsAsXrp(selectedReserve.toString()) }} estimated reserve
        </p>
      </div>

      <section
        v-if="!activeIntent"
        class="acme-card p-6"
      >
        <h2 class="font-semibold">
          Sequential transfer queue
        </h2><p class="mt-2 text-sm text-[#62789C]">
          Each transfer must validate before the next sequence is prepared.
        </p><div class="mt-4 flex flex-wrap gap-2">
          <UButton
            v-for="target in eligible.filter(item => selected.includes(item.id) && !item.intent)"
            :key="target.id"
            :label="`Prepare ${target.objectType}`"
            :loading="busy"
            @click="prepare(target)"
          />
        </div><p
          v-if="!eligible.some(item => selected.includes(item.id) && !item.intent)"
          class="mt-4 text-sm text-[#62789C]"
        >
          No selected target is waiting to be prepared.
        </p>
      </section>

      <section
        v-else
        class="acme-card p-6"
      >
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p class="acme-kicker">
              Wallet authorization
            </p><h2 class="mt-1 font-semibold">
              Sign exact SponsorshipTransfer
            </h2>
          </div><UButton
            label="Copy transaction JSON"
            icon="i-lucide-copy"
            color="neutral"
            variant="outline"
            @click="copyTransaction"
          />
        </div><pre class="mt-4 max-h-72 overflow-auto rounded-xl bg-[#071733] p-4 text-xs text-[#DCEBFF]">{{ JSON.stringify(activeIntent.transaction, null, 2) }}</pre><UFormField
          class="mt-5"
          label="Wallet-signed transaction blob"
          help="This is the wallet-agnostic boundary xrpl-connect will call. The backend decodes and verifies the blob before using the sponsor key."
        >
          <UTextarea
            v-model="signedBlob"
            class="w-full"
            :rows="5"
            placeholder="Paste the signed hexadecimal transaction blob"
          />
        </UFormField><div class="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p class="text-xs text-[#62789C]">
            Intent {{ activeIntent.id }} · expires {{ new Date(activeIntent.expiresAt).toLocaleTimeString() }}
          </p><UButton
            label="Verify, sponsor, and submit"
            icon="i-lucide-shield-check"
            :loading="busy"
            :disabled="signedBlob.trim().length < 20 || Boolean(authorizeResult)"
            @click="authorize"
          />
        </div><UAlert
          v-if="authorizeResult"
          class="mt-5"
          color="success"
          variant="subtle"
          title="Signed blob persisted for submission"
          :description="`Transaction ${authorizeResult.transactionHash}. ACME will only mark it complete after validated-ledger reconciliation.`"
        /><div
          v-if="activeTerminal"
          class="mt-5 flex justify-end"
        >
          <UButton
            label="Continue to next transfer"
            trailing-icon="i-lucide-arrow-right"
            @click="continueQueue"
          />
        </div>
      </section>
    </template>
  </div>
</template>
