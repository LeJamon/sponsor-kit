<script setup lang="ts">
import { clearDisposableWallet, createDisposableWallet, getDisposableWallet, signCanonicalTransaction, verifyProtocolDefinitions, type DisposableWallet, type RawXrplDefinitions } from '~/utils/browser-signing'
import { formatDateTime, formatDropsAsXrp, shortenAddress } from '~/utils/format'
import { transactionExplorerUrl } from '~/utils/explorer'

definePageMeta({ layout: 'dashboard' })

type Context = { projects?: Array<{ project: { publicId: string, name: string, network: string } }> }
type Readiness = { ready: boolean, checks: Array<{ key: string, label: string, ok: boolean, detail: string }> }
type Protocol = { network: 'devnet', networkId: number, definitionsHash: string, definitions: RawXrplDefinitions }
type FundResult = { account: string, funded: boolean, pending: boolean, balanceDrops: string | null, ledgerIndex: number | null }
type Intent = {
  id: string
  state: string
  network: string
  networkId: number
  definitionsHash: string
  account: string
  transaction: Record<string, unknown>
  canonicalHash: string
  sponsorship: { feeDrops: string, reserveDrops: string }
  expiresAt: string
  grant: string
}
type IntentDetail = Intent & {
  canonicalTransaction?: Record<string, unknown>
  events: Array<{ id: string, version: number, fromState: string | null, toState: string, actor: string, createdAt: string }>
  submissions: Array<{ attempt: number, transactionHash: string, engineResult: string | null, ledgerIndex: number | null, validatedAt: string | null, createdAt: string }>
}

const terminalStates = new Set(['validated', 'failed', 'rejected', 'expired', 'cancelled', 'superseded'])
const context = await useFetch<Context>('/api/console/context')
const projectId = computed(() => context.data.value?.projects?.[0]?.project.publicId)
const { data: readiness, status: readinessStatus, error: readinessError, refresh: refreshReadiness } = await useFetch<Readiness>('/api/console/readiness')
const { data: protocol, status: protocolStatus, error: protocolError } = await useAsyncData<Protocol | null>('devnet-protocol', () => projectId.value ? $fetch(`/api/console/projects/${projectId.value}/protocol`) : Promise.resolve(null), { watch: [projectId] })

const wallet = ref<DisposableWallet | null>(null)
const fundResult = ref<FundResult | null>(null)
const intent = ref<Intent | null>(null)
const intentDetail = ref<IntentDetail | null>(null)
const signedBlob = ref('')
const signingPayload = ref('')
const destination = ref('')
const amountDrops = ref('1')
const idempotencyKey = ref('')
const intentRequestSnapshot = ref<{ destination: string, amountDrops: string } | null>(null)
const busy = ref(false)
const errorMessage = ref('')
const destinationError = ref('')
const fundStatus = ref<'idle' | 'pending' | 'funded' | 'failed'>('idle')
const fundError = ref('')
const stage = ref<'wallet' | 'funding' | 'details' | 'review' | 'signed' | 'waiting' | 'success' | 'failure'>('wallet')
const authorizationOutcomeUnknown = ref(false)
const pollAttempt = ref(0)
const lastCheckedAt = ref<string | null>(null)
let fundingTimer: ReturnType<typeof setTimeout> | undefined
let intentTimer: ReturnType<typeof setTimeout> | undefined
let stopped = false
let fundingRefreshGeneration = 0
let intentRefreshGeneration = 0

const networkReady = computed(() => readiness.value?.ready === true)
const definitionsVerified = computed(() => Boolean(
  intent.value && protocol.value && verifyProtocolDefinitions({
    definitions: protocol.value.definitions,
    definitionsHash: protocol.value.definitionsHash,
    expectedDefinitionsHash: intent.value.definitionsHash
  })
))
const currentState = computed(() => intentDetail.value?.state || intent.value?.state || '')
const latestSubmission = computed(() => intentDetail.value?.submissions?.at(-1))
const transactionHash = computed(() => latestSubmission.value?.transactionHash || null)
const explorerUrl = computed(() => transactionExplorerUrl(intent.value?.network || 'devnet', transactionHash.value))
const progressSteps = [
  { key: 'wallet', label: 'Wallet' },
  { key: 'details', label: 'Payment' },
  { key: 'review', label: 'Review' },
  { key: 'waiting', label: 'Settlement' }
]

onMounted(() => {
  wallet.value = getDisposableWallet()
  if (wallet.value && !fundResult.value) stage.value = 'funding'
})

function requestMessage(error: unknown, fallback: string) {
  if (error && typeof error === 'object' && 'data' in error && error.data && typeof error.data === 'object' && 'statusMessage' in error.data) {
    return String(error.data.statusMessage)
  }
  return error instanceof Error ? error.message : fallback
}

function clearTimers() {
  if (fundingTimer) clearTimeout(fundingTimer)
  if (intentTimer) clearTimeout(intentTimer)
  fundingTimer = undefined
  intentTimer = undefined
  fundingRefreshGeneration += 1
  intentRefreshGeneration += 1
}

function errorStatus(error: unknown) {
  if (!error || typeof error !== 'object') return undefined
  if ('statusCode' in error && typeof error.statusCode === 'number') return error.statusCode
  if ('status' in error && typeof error.status === 'number') return error.status
  if ('response' in error && error.response && typeof error.response === 'object' && 'status' in error.response && typeof error.response.status === 'number') return error.response.status
  return undefined
}

function signingValidationError() {
  if (!intent.value || !protocol.value || !wallet.value) return 'The wallet or transaction is no longer available. Start again in this tab.'
  if (intent.value.network !== 'devnet' || protocol.value.network !== 'devnet' || intent.value.networkId !== protocol.value.networkId) return 'This intent is not a Devnet transaction for the current network protocol.'
  const transaction = intent.value.transaction
  if (intent.value.account !== wallet.value.address || transaction.Account !== wallet.value.address) return 'The approved account does not match this disposable wallet.'
  if (transaction.TransactionType !== 'Payment' || typeof transaction.Destination !== 'string' || !isValidAddress(transaction.Destination) || !isValidDrops(String(transaction.Amount ?? ''))) return 'The approved transaction is not a valid Devnet Payment.'
  if (transaction.Destination !== destination.value.trim() || String(transaction.Amount) !== amountDrops.value.trim()) return 'The approved Payment changed after it was requested. Start over and review the new details before signing.'
  if (typeof transaction.Sponsor !== 'string' || !isValidAddress(transaction.Sponsor)) return 'The approved transaction is missing a valid sponsor account.'
  if (!Number.isInteger(Number(transaction.SponsorFlags)) || Number(transaction.SponsorFlags) <= 0) return 'The approved transaction has invalid sponsorship flags.'
  const managedNumbers = ['Fee', 'Sequence', 'LastLedgerSequence'].map(field => String(transaction[field] ?? ''))
  if (managedNumbers.some(value => !/^\d+$/.test(value) || Number(value) <= 0)) return 'The approved transaction is missing a valid fee, sequence, or ledger deadline.'
  const expiresAt = Date.parse(intent.value.expiresAt)
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return 'This intent expired before signing. Start a fresh payment.'
  if (!definitionsVerified.value) return 'The Devnet protocol definitions changed. Refresh the intent before signing.'
  return ''
}

function isValidAddress(value: string) {
  return /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(value.trim())
}

function isValidDrops(value: string) {
  return /^[1-9]\d*$/.test(value.trim()) && BigInt(value.trim()) <= 1_000_000_000n
}

async function createWallet() {
  clearTimers()
  clearDisposableWallet()
  try {
    wallet.value = await createDisposableWallet()
  } catch (error: unknown) {
    wallet.value = null
    stage.value = 'wallet'
    errorMessage.value = requestMessage(error, 'A secure browser wallet could not be created. Check that this page is using HTTPS and try again.')
    return
  }
  fundResult.value = null
  fundStatus.value = 'idle'
  fundError.value = ''
  intent.value = null
  intentDetail.value = null
  signedBlob.value = ''
  signingPayload.value = ''
  idempotencyKey.value = ''
  intentRequestSnapshot.value = null
  authorizationOutcomeUnknown.value = false
  errorMessage.value = ''
  stage.value = 'funding'
}

async function fundWallet() {
  if (!projectId.value || !wallet.value) return
  busy.value = true
  fundError.value = ''
  errorMessage.value = ''
  try {
    const result = await $fetch<FundResult>('/api/console/devnet/fund', {
      method: 'POST',
      body: { account: wallet.value.address }
    })
    fundResult.value = result
    fundStatus.value = result.funded ? 'funded' : result.pending ? 'pending' : 'failed'
    if (result.funded) {
      stage.value = 'details'
    } else if (result.pending) {
      stage.value = 'funding'
      scheduleFundingPoll()
    } else {
      fundError.value = 'The faucet did not confirm this account. Retry the funding request or create a fresh disposable wallet.'
    }
  } catch (error: unknown) {
    fundStatus.value = 'failed'
    fundError.value = requestMessage(error, 'Devnet funding is unavailable right now.')
  } finally {
    busy.value = false
  }
}

function scheduleFundingPoll() {
  if (!wallet.value || !projectId.value || stopped) return
  if (fundingTimer) clearTimeout(fundingTimer)
  fundingTimer = setTimeout(() => void refreshFundingStatus(), 3_000)
}

async function refreshFundingStatus() {
  if (!wallet.value || !projectId.value || stopped) return
  if (fundingTimer) clearTimeout(fundingTimer)
  fundingTimer = undefined
  const generation = ++fundingRefreshGeneration
  try {
    const result = await $fetch<FundResult>(`/api/console/projects/${projectId.value}/accounts/${encodeURIComponent(wallet.value.address)}`)
    if (generation !== fundingRefreshGeneration || stopped) return
    fundResult.value = result
    if (result.funded) {
      fundStatus.value = 'funded'
      stage.value = 'details'
      return
    }
    fundStatus.value = 'pending'
    scheduleFundingPoll()
  } catch (error: unknown) {
    if (generation !== fundingRefreshGeneration || stopped) return
    fundError.value = requestMessage(error, 'The funding status could not be checked.')
    scheduleFundingPoll()
  }
}

function continueToPayment() {
  if (!fundResult.value?.funded) {
    fundError.value = 'Wait for Devnet to confirm the disposable wallet before creating a transaction.'
    stage.value = 'funding'
    return
  }
  stage.value = 'details'
  errorMessage.value = ''
}

async function createIntent() {
  destinationError.value = ''
  errorMessage.value = ''
  if (!projectId.value || !wallet.value) return
  if (!networkReady.value) {
    errorMessage.value = 'Network readiness checks are not complete. Refresh them before creating an intent.'
    return
  }
  if (!isValidAddress(destination.value)) {
    destinationError.value = 'Enter a valid Devnet account address beginning with r.'
    return
  }
  if (!isValidDrops(amountDrops.value)) {
    destinationError.value = 'Enter an amount in drops between 1 and 1,000,000,000.'
    return
  }
  const requestedDestination = destination.value.trim()
  const requestedAmount = amountDrops.value.trim()
  if (idempotencyKey.value && intentRequestSnapshot.value && (intentRequestSnapshot.value.destination !== requestedDestination || intentRequestSnapshot.value.amountDrops !== requestedAmount)) {
    errorMessage.value = 'This request may already be in progress. Start over before changing payment details so an uncertain retry cannot create a duplicate.'
    return
  }
  busy.value = true
  try {
    if (!idempotencyKey.value) {
      idempotencyKey.value = globalThis.crypto.randomUUID()
      intentRequestSnapshot.value = { destination: requestedDestination, amountDrops: requestedAmount }
    }
    const result = await $fetch<Intent>(`/api/console/projects/${projectId.value}/intents`, {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey.value },
      body: {
        account: wallet.value.address,
        transaction: {
          TransactionType: 'Payment',
          Destination: requestedDestination,
          Amount: requestedAmount
        },
        sponsorship: { fee: true, reserve: false },
        signing: { mode: 'single', signerCount: 1 }
      }
    })
    intent.value = result
    if (!protocol.value || !verifyProtocolDefinitions({ definitions: protocol.value.definitions, definitionsHash: protocol.value.definitionsHash, expectedDefinitionsHash: result.definitionsHash })) {
      throw new Error('The Devnet protocol definitions changed while the intent was being prepared. Refresh and try again.')
    }
    stage.value = 'review'
  } catch (error: unknown) {
    errorMessage.value = requestMessage(error, 'The sponsorship intent could not be prepared.')
  } finally {
    busy.value = false
  }
}

async function signIntent() {
  if (!intent.value || !protocol.value) return
  busy.value = true
  errorMessage.value = ''
  try {
    const validationError = signingValidationError()
    if (validationError) {
      errorMessage.value = validationError
      return
    }
    const result = await signCanonicalTransaction({
      transaction: intent.value.transaction,
      definitions: protocol.value.definitions,
      expectedDefinitionsHash: intent.value.definitionsHash,
      protocolDefinitionsHash: protocol.value.definitionsHash,
      account: intent.value.account
    })
    signedBlob.value = result.signedBlob
    signingPayload.value = result.signingPayload
    stage.value = 'signed'
  } catch (error: unknown) {
    errorMessage.value = requestMessage(error, 'The exact transaction could not be signed in this tab.')
  } finally {
    busy.value = false
  }
}

async function authorizeIntent() {
  if (!intent.value || !signedBlob.value || !projectId.value) return
  busy.value = true
  errorMessage.value = ''
  authorizationOutcomeUnknown.value = false
  clearTimers()
  try {
    await $fetch(`/api/v1/intents/${intent.value.id}/authorize`, {
      method: 'POST',
      body: { grant: intent.value.grant, signedTransaction: signedBlob.value }
    })
    stage.value = 'waiting'
    pollAttempt.value = 0
    await refreshIntent()
  } catch (error: unknown) {
    const status = errorStatus(error)
    const outcomeUnknown = status === undefined || status === 408 || status === 409 || (status >= 500 && status <= 599)
    if (!outcomeUnknown) {
      stage.value = 'failure'
      errorMessage.value = requestMessage(error, 'The signed transaction was rejected before submission.')
    } else {
      stage.value = 'waiting'
      authorizationOutcomeUnknown.value = true
      errorMessage.value = 'The authorization request was interrupted. Its outcome is unknown, so ACME is checking the existing intent before you retry.'
      await refreshIntent()
    }
  } finally {
    busy.value = false
  }
}

async function refreshIntent() {
  if (!intent.value || !projectId.value || stopped) return
  if (intentTimer) clearTimeout(intentTimer)
  intentTimer = undefined
  const generation = ++intentRefreshGeneration
  try {
    const detail = await $fetch<IntentDetail>(`/api/console/projects/${projectId.value}/intents/${intent.value.id}`)
    if (generation !== intentRefreshGeneration || stopped) return
    lastCheckedAt.value = new Date().toISOString()
    intentDetail.value = detail
    intent.value = { ...intent.value, state: detail.state }
    if (detail.state !== 'awaiting_user_signature') authorizationOutcomeUnknown.value = false
    if (detail.state === 'validated') {
      stage.value = 'success'
      clearTimers()
      return
    }
    if (terminalStates.has(detail.state)) {
      stage.value = 'failure'
      clearTimers()
      return
    }
    stage.value = 'waiting'
    pollAttempt.value += 1
    const delay = Math.min(10_000, 1_500 + (pollAttempt.value * 750))
    intentTimer = setTimeout(() => void refreshIntent(), delay)
  } catch (error: unknown) {
    if (generation !== intentRefreshGeneration || stopped) return
    lastCheckedAt.value = new Date().toISOString()
    errorMessage.value = requestMessage(error, 'The live transaction status could not be checked.')
    pollAttempt.value += 1
    intentTimer = setTimeout(() => void refreshIntent(), Math.min(15_000, 2_000 + pollAttempt.value * 1_000))
  }
}

function startOver() {
  clearTimers()
  intent.value = null
  intentDetail.value = null
  signedBlob.value = ''
  signingPayload.value = ''
  idempotencyKey.value = ''
  intentRequestSnapshot.value = null
  authorizationOutcomeUnknown.value = false
  errorMessage.value = ''
  stage.value = fundResult.value?.funded ? 'details' : 'funding'
}

function resetWallet() {
  clearTimers()
  clearDisposableWallet()
  wallet.value = null
  fundResult.value = null
  fundStatus.value = 'idle'
  stage.value = 'wallet'
  intent.value = null
  intentDetail.value = null
  signedBlob.value = ''
  signingPayload.value = ''
  idempotencyKey.value = ''
  intentRequestSnapshot.value = null
  authorizationOutcomeUnknown.value = false
  errorMessage.value = ''
  fundError.value = ''
}

onBeforeUnmount(() => {
  stopped = true
  clearTimers()
})
</script>

<template>
  <div class="mx-auto max-w-5xl">
    <ConsolePageHeader
      eyebrow="Guided Devnet pilot"
      title="Make your first sponsored payment"
      description="Create a disposable Devnet wallet, review the exact Payment, sign it in this browser, and watch the validated ledger confirm it."
    >
      <UButton
        to="/app/intents"
        label="View transactions"
        icon="i-lucide-list-checks"
        color="neutral"
        variant="outline"
      />
    </ConsolePageHeader>

    <div class="mb-6 grid gap-2 sm:grid-cols-4">
      <div
        v-for="(step, index) in progressSteps"
        :key="step.key"
        class="flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm"
        :class="(stage === step.key || (step.key === 'waiting' && ['signed', 'waiting', 'success', 'failure'].includes(stage))) ? 'border-[#0A3DFF] bg-[#DCEBFF] text-[#0A3DFF]' : 'border-[#D9E5F7] bg-white text-[#62789C]'"
      >
        <span class="grid size-6 shrink-0 place-items-center rounded-full bg-white text-xs font-semibold shadow-sm">{{ index + 1 }}</span>
        <span class="font-medium">{{ step.label }}</span>
      </div>
    </div>

    <UAlert
      v-if="readinessError || protocolError"
      class="mb-6"
      color="error"
      title="Devnet readiness could not be checked"
      :description="readinessError?.message || protocolError?.message"
    >
      <template #actions>
        <UButton
          label="Retry readiness"
          color="error"
          variant="soft"
          @click="() => refreshReadiness()"
        />
      </template>
    </UAlert>
    <UAlert
      v-else-if="readinessStatus === 'pending' || protocolStatus === 'pending'"
      class="mb-6"
      color="primary"
      variant="subtle"
      icon="i-lucide-loader-circle"
      title="Checking live Devnet readiness"
      description="The transaction form will unlock when the sponsor and protocol checks return ready."
    />
    <UAlert
      v-else-if="!networkReady"
      class="mb-6"
      color="warning"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      title="Devnet is not ready for sponsorship"
      description="Resolve the failed readiness checks in setup before creating a transaction."
    >
      <template #actions>
        <UButton
          to="/app/setup"
          label="Open readiness checks"
          color="warning"
          variant="soft"
        />
      </template>
    </UAlert>

    <UAlert
      v-if="errorMessage"
      class="mb-6"
      color="error"
      variant="subtle"
      title="Payment flow needs attention"
      :description="errorMessage"
    />

    <section
      v-if="stage === 'wallet'"
      class="acme-card overflow-hidden"
    >
      <div class="grid gap-8 p-6 sm:p-8 lg:grid-cols-[1.15fr_.85fr] lg:items-center">
        <div>
          <p class="acme-kicker">
            Step 1 · Disposable wallet
          </p>
          <h2 class="mt-3 text-2xl font-bold tracking-tight">
            Use a safe browser-only Devnet wallet
          </h2>
          <p class="mt-3 max-w-xl text-sm leading-6 text-[#62789C]">
            ACME generates an ed25519 key in this tab, uses it to sign one Devnet demo, and never sends or stores the seed. Reloading this page discards the demo wallet, so keep no real funds here.
          </p>
          <div class="mt-6 flex flex-wrap gap-3">
            <UButton
              label="Generate disposable wallet"
              icon="i-lucide-sparkles"
              size="lg"
              :disabled="!networkReady"
              @click="createWallet"
            />
            <UButton
              to="/app/setup"
              label="Review readiness"
              color="neutral"
              variant="ghost"
            />
          </div>
        </div>
        <div class="rounded-2xl border border-[#D9E5F7] bg-[#F7FAFF] p-5">
          <div class="flex items-center gap-3">
            <span class="grid size-10 place-items-center rounded-xl bg-[#DCEBFF] text-[#0A3DFF]"><UIcon name="i-lucide-shield-check" /></span>
            <div>
              <p class="font-semibold">
                What stays local
              </p>
              <p class="text-xs text-[#62789C]">
                Private key memory only
              </p>
            </div>
          </div>
          <ul class="mt-5 space-y-3 text-sm text-[#62789C]">
            <li class="flex gap-2">
              <UIcon
                name="i-lucide-check"
                class="mt-0.5 size-4 shrink-0 text-emerald-600"
              />The seed is never rendered or transmitted.
            </li>
            <li class="flex gap-2">
              <UIcon
                name="i-lucide-check"
                class="mt-0.5 size-4 shrink-0 text-emerald-600"
              />Only the public address reaches the faucet and intent API.
            </li>
            <li class="flex gap-2">
              <UIcon
                name="i-lucide-check"
                class="mt-0.5 size-4 shrink-0 text-emerald-600"
              />Only Devnet accounts are supported in this pilot.
            </li>
          </ul>
        </div>
      </div>
    </section>

    <section
      v-else-if="stage === 'funding'"
      class="acme-card p-6 sm:p-8"
    >
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p class="acme-kicker">
            Step 2 · Fund the demo wallet
          </p>
          <h2 class="mt-3 text-2xl font-bold tracking-tight">
            Get a small Devnet balance
          </h2>
          <p class="mt-2 max-w-2xl text-sm leading-6 text-[#62789C]">
            The faucet funds this address on Devnet. Funding may take a few ledgers to become visible.
          </p>
        </div>
        <UBadge
          label="Devnet only"
          color="primary"
          variant="subtle"
        />
      </div>
      <div class="mt-6 rounded-xl border border-[#D9E5F7] bg-[#F7FAFF] p-4">
        <p class="text-xs font-semibold uppercase tracking-[0.14em] text-[#62789C]">
          Disposable account
        </p>
        <p class="mt-2 break-all font-mono text-sm">
          {{ wallet?.address }}
        </p>
        <p class="mt-2 text-xs text-[#62789C]">
          This address and its Devnet balance are real network data; the private key remains in memory.
        </p>
      </div>
      <UAlert
        v-if="fundError"
        class="mt-5"
        color="error"
        variant="subtle"
        title="Funding needs attention"
        :description="fundError"
      />
      <UAlert
        v-if="fundResult?.pending"
        class="mt-5"
        color="primary"
        variant="subtle"
        icon="i-lucide-loader-circle"
        title="Waiting for the validated ledger"
        description="We are checking the funded account every few seconds. You can leave this tab open while Devnet settles it."
      />
      <div class="mt-6 flex flex-wrap items-center gap-3">
        <UButton
          :label="fundStatus === 'pending' ? 'Check funding status' : 'Fund disposable wallet'"
          icon="i-lucide-droplets"
          :loading="busy || fundStatus === 'pending'"
          @click="fundStatus === 'pending' ? refreshFundingStatus() : fundWallet()"
        />
        <UButton
          v-if="fundResult?.funded"
          label="Continue to payment"
          trailing-icon="i-lucide-arrow-right"
          color="neutral"
          variant="outline"
          @click="continueToPayment"
        />
        <UButton
          label="Discard wallet"
          color="neutral"
          variant="ghost"
          @click="resetWallet"
        />
      </div>
    </section>

    <section
      v-else-if="stage === 'details'"
      class="acme-card p-6 sm:p-8"
    >
      <p class="acme-kicker">
        Step 3 · Payment details
      </p>
      <h2 class="mt-3 text-2xl font-bold tracking-tight">
        Choose where the sponsored payment goes
      </h2>
      <p class="mt-2 max-w-2xl text-sm leading-6 text-[#62789C]">
        Enter an existing Devnet destination. ACME will add the fee, sequence, deadline, and sponsor fields after you submit this form.
      </p>
      <form
        class="mt-7 max-w-2xl space-y-5"
        @submit.prevent="createIntent"
      >
        <UFormField
          label="Destination address"
          :error="destinationError || undefined"
          help="Devnet account beginning with r…"
        >
          <UInput
            v-model="destination"
            class="w-full"
            size="lg"
            placeholder="r…"
            autocomplete="off"
            required
          />
        </UFormField>
        <UFormField
          label="Amount"
          help="Drops · 1 XRP = 1,000,000 drops"
        >
          <UInput
            v-model="amountDrops"
            class="w-full"
            size="lg"
            inputmode="numeric"
            required
          />
        </UFormField>
        <div class="rounded-xl border border-[#D9E5F7] bg-[#F7FAFF] p-4 text-sm">
          <div class="flex items-center justify-between gap-4">
            <span class="text-[#62789C]">Payment fee</span><span class="font-medium text-[#0A3DFF]">Sponsored</span>
          </div>
          <div class="mt-3 flex items-center justify-between gap-4">
            <span class="text-[#62789C]">Reserve</span><span class="font-medium text-[#62789C]">Not requested</span>
          </div>
        </div>
        <div class="flex flex-wrap gap-3">
          <UButton
            type="submit"
            label="Review sponsored payment"
            trailing-icon="i-lucide-arrow-right"
            :loading="busy"
            :disabled="!networkReady || !fundResult?.funded"
          />
          <UButton
            label="Use another wallet"
            color="neutral"
            variant="ghost"
            @click="resetWallet"
          />
          <UButton
            v-if="idempotencyKey"
            label="Start over"
            color="neutral"
            variant="ghost"
            @click="startOver"
          />
        </div>
      </form>
    </section>

    <section
      v-else-if="['review', 'signed'].includes(stage) && intent"
      class="acme-card overflow-hidden"
    >
      <div class="border-b border-[#D9E5F7] p-6 sm:p-8">
        <p class="acme-kicker">
          Step 4 · Review and sign
        </p>
        <div class="mt-3 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 class="text-2xl font-bold tracking-tight">
              Sign the exact approved transaction
            </h2>
            <p class="mt-2 max-w-2xl text-sm leading-6 text-[#62789C]">
              Review every field below. Your browser signs this canonical payload only after the Devnet definitions hash matches the intent.
            </p>
          </div>
          <UBadge
            :label="definitionsVerified ? 'Definitions verified' : 'Definitions need refresh'"
            :color="definitionsVerified ? 'success' : 'warning'"
            variant="subtle"
            icon="i-lucide-shield-check"
          />
        </div>
      </div>
      <div class="grid gap-6 p-6 sm:p-8 lg:grid-cols-[.85fr_1.15fr]">
        <div class="space-y-4 text-sm">
          <div>
            <p class="text-xs font-semibold uppercase tracking-[0.14em] text-[#62789C]">
              Wallet
            </p>
            <p class="mt-1 break-all font-mono text-xs">
              {{ shortenAddress(intent.account) }}
            </p>
          </div>
          <div>
            <p class="text-xs font-semibold uppercase tracking-[0.14em] text-[#62789C]">
              Intent
            </p>
            <p class="mt-1 break-all font-mono text-xs">
              {{ intent.id }}
            </p>
          </div>
          <div>
            <p class="text-xs font-semibold uppercase tracking-[0.14em] text-[#62789C]">
              Canonical hash
            </p>
            <p class="mt-1 break-all font-mono text-xs">
              {{ intent.canonicalHash }}
            </p>
          </div>
          <div>
            <p class="text-xs font-semibold uppercase tracking-[0.14em] text-[#62789C]">
              Definitions hash
            </p>
            <p class="mt-1 break-all font-mono text-xs">
              {{ intent.definitionsHash }}
            </p>
          </div>
          <div class="rounded-xl bg-[#F7FAFF] p-4">
            <div class="flex items-center justify-between gap-3">
              <span class="text-[#62789C]">Network fee</span><span class="font-semibold">{{ formatDropsAsXrp(intent.sponsorship.feeDrops) }}</span>
            </div>
            <div class="mt-2 flex items-center justify-between gap-3">
              <span class="text-[#62789C]">Reserve</span><span class="font-semibold">{{ formatDropsAsXrp(intent.sponsorship.reserveDrops) }}</span>
            </div>
          </div>
          <p class="text-xs leading-5 text-[#62789C]">
            Expires {{ formatDateTime(intent.expiresAt) }}. If the ledger deadline passes, create a fresh intent instead of reusing this one.
          </p>
        </div>
        <div>
          <p class="text-sm font-semibold">
            Canonical transaction JSON
          </p>
          <pre class="mt-3 max-h-96 overflow-auto rounded-xl bg-[#071733] p-4 text-xs leading-5 text-[#DCEBFF]">{{ JSON.stringify(intent.transaction, null, 2) }}</pre>
          <UAlert
            v-if="stage === 'signed'"
            class="mt-4"
            color="success"
            variant="subtle"
            title="Signature created in this tab"
            description="The private key stayed in memory. Submit this signature to let ACME verify it, sponsor the fee, and submit the transaction."
          />
          <div class="mt-5 flex flex-wrap gap-3">
            <UButton
              v-if="stage === 'review'"
              label="Sign exact transaction"
              icon="i-lucide-pen-line"
              :loading="busy"
              :disabled="!definitionsVerified"
              @click="signIntent"
            />
            <UButton
              v-else
              label="Submit signed transaction"
              icon="i-lucide-send"
              :loading="busy"
              @click="authorizeIntent"
            />
            <UButton
              label="Start over"
              color="neutral"
              variant="ghost"
              @click="startOver"
            />
          </div>
          <details
            v-if="stage === 'signed'"
            class="mt-5 rounded-xl border border-[#D9E5F7] p-4"
          >
            <summary class="cursor-pointer text-sm font-medium">
              Show signed payload details
            </summary>
            <p class="mt-3 break-all font-mono text-[11px] leading-5 text-[#62789C]">
              Signing payload {{ signingPayload }}
            </p>
            <p class="mt-3 break-all font-mono text-[11px] leading-5 text-[#62789C]">
              Signed blob {{ signedBlob }}
            </p>
          </details>
        </div>
      </div>
    </section>

    <section
      v-else-if="stage === 'waiting'"
      class="acme-card p-6 sm:p-8"
    >
      <div class="flex items-start gap-4">
        <span class="grid size-12 shrink-0 place-items-center rounded-full bg-[#DCEBFF] text-[#0A3DFF]"><UIcon
          name="i-lucide-loader-circle"
          class="size-6 animate-spin"
        /></span>
        <div>
          <p class="acme-kicker">
            Step 5 · Settlement
          </p>
          <h2 class="mt-2 text-2xl font-bold tracking-tight">
            Watching the validated ledger
          </h2>
          <p class="mt-2 max-w-2xl text-sm leading-6 text-[#62789C]">
            The signed blob was accepted for submission. ACME will show success only after Devnet reports a validated transaction.
          </p>
        </div>
      </div>
      <div class="mt-7 grid gap-3 sm:grid-cols-3">
        <div class="rounded-xl bg-[#F7FAFF] p-4">
          <p class="text-xs text-[#62789C]">
            Intent
          </p><p class="mt-1 font-mono text-xs">
            {{ intent?.id }}
          </p>
        </div>
        <div class="rounded-xl bg-[#F7FAFF] p-4">
          <p class="text-xs text-[#62789C]">
            Current state
          </p><p class="mt-1 font-medium capitalize">
            {{ currentState.replaceAll('_', ' ') || 'Submitting' }}
          </p>
        </div>
        <div class="rounded-xl bg-[#F7FAFF] p-4">
          <p class="text-xs text-[#62789C]">
            Last checked
          </p><p class="mt-1 text-sm">
            {{ formatDateTime(lastCheckedAt) }}
          </p>
        </div>
      </div>
      <UAlert
        v-if="authorizationOutcomeUnknown"
        class="mt-6"
        color="warning"
        variant="subtle"
        title="Submission outcome is unknown"
        description="The request may have reached ACME. Wait for the state check above, then retry authorization only if the intent is still awaiting your signature."
      />
      <div class="mt-6 flex flex-wrap gap-3">
        <UButton
          label="Refresh transaction status"
          icon="i-lucide-refresh-cw"
          :loading="busy"
          @click="refreshIntent"
        />
        <UButton
          v-if="authorizationOutcomeUnknown && currentState === 'awaiting_user_signature'"
          label="Retry authorization request"
          icon="i-lucide-repeat-2"
          color="warning"
          variant="soft"
          :loading="busy"
          @click="authorizeIntent"
        />
        <UButton
          v-if="intent"
          :to="`/app/intents/${intent.id}`"
          label="Open transaction detail"
          color="neutral"
          variant="outline"
        />
      </div>
    </section>

    <section
      v-else-if="stage === 'success'"
      class="acme-card border-emerald-200 p-6 sm:p-8"
    >
      <div class="flex items-start gap-4">
        <span class="grid size-12 shrink-0 place-items-center rounded-full bg-emerald-50 text-emerald-700"><UIcon
          name="i-lucide-circle-check"
          class="size-6"
        /></span>
        <div>
          <p class="acme-kicker">
            Validated on Devnet
          </p>
          <h2 class="mt-2 text-2xl font-bold tracking-tight">
            Your first sponsored payment completed
          </h2>
          <p class="mt-2 max-w-2xl text-sm leading-6 text-[#62789C]">
            The payment was accepted by the network and observed in a validated ledger. The fee was sponsored according to the approved policy.
          </p>
        </div>
      </div>
      <div class="mt-7 rounded-xl bg-emerald-50 p-4 text-sm">
        <p class="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-800">
          Transaction hash
        </p>
        <p class="mt-2 break-all font-mono text-xs text-emerald-900">
          {{ transactionHash }}
        </p>
      </div>
      <div class="mt-6 flex flex-wrap gap-3">
        <UButton
          v-if="explorerUrl"
          :href="explorerUrl"
          target="_blank"
          rel="noopener noreferrer"
          label="Open Devnet Explorer"
          icon="i-lucide-external-link"
        />
        <UButton
          v-if="intent"
          :to="`/app/intents/${intent.id}`"
          label="View transaction detail"
          color="neutral"
          variant="outline"
        />
        <UButton
          label="Make another payment"
          color="neutral"
          variant="ghost"
          @click="startOver"
        />
      </div>
    </section>

    <section
      v-else-if="stage === 'failure'"
      class="acme-card border-rose-200 p-6 sm:p-8"
    >
      <div class="flex items-start gap-4">
        <span class="grid size-12 shrink-0 place-items-center rounded-full bg-rose-50 text-rose-700"><UIcon
          name="i-lucide-triangle-alert"
          class="size-6"
        /></span>
        <div>
          <p class="acme-kicker">
            Transaction needs attention
          </p>
          <h2 class="mt-2 text-2xl font-bold tracking-tight">
            Devnet did not validate this payment
          </h2>
          <p class="mt-2 max-w-2xl text-sm leading-6 text-[#62789C]">
            No success is shown until the network confirms finality. Review the detail record for the exact state and retry with a fresh intent if it expired or was rejected.
          </p>
        </div>
      </div>
      <div class="mt-6 rounded-xl bg-rose-50 p-4 text-sm text-rose-900">
        <p class="font-semibold">
          Current state: <span class="capitalize">{{ currentState.replaceAll('_', ' ') }}</span>
        </p>
        <p
          v-if="errorMessage"
          class="mt-2"
        >
          {{ errorMessage }}
        </p>
      </div>
      <div class="mt-6 flex flex-wrap gap-3">
        <UButton
          v-if="intent"
          :to="`/app/intents/${intent.id}`"
          label="Open transaction detail"
          icon="i-lucide-file-search"
        />
        <UButton
          label="Try a fresh payment"
          color="neutral"
          variant="outline"
          @click="startOver"
        />
      </div>
    </section>
  </div>
</template>
