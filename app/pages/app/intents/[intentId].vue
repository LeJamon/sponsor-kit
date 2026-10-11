<script setup lang="ts">
import { formatDateTime, formatDropsAsXrp, shortenAddress } from '~/utils/format'
import { transactionExplorerUrl } from '~/utils/explorer'

const requestFetch = useRequestFetch()

definePageMeta({ layout: 'dashboard' })

type IntentEvent = { id: string, version: number, fromState: string | null, toState: string, actor: string, createdAt: string }
type Submission = { attempt: number, transactionHash: string, engineResult: string | null, ledgerIndex: number | null, validatedAt: string | null, createdAt: string }
type IntentDetail = {
  id: string
  projectId: string
  state: string
  network: string
  networkId: number
  definitionsHash: string
  accountAddress: string
  canonicalTransaction: Record<string, unknown>
  canonicalHash: string
  estimatedFeeDrops: string
  estimatedReserveDrops: string
  expiresAt: string
  createdAt: string
  updatedAt: string
  events: IntentEvent[]
  submissions: Submission[]
}

const route = useRoute()
const intentId = computed(() => String(route.params.intentId || ''))
const terminalStates = new Set(['validated', 'failed', 'rejected', 'expired', 'cancelled', 'superseded'])
const { projectId } = await useConsoleProject()
const { data: intent, status, error, refresh } = await useAsyncData<IntentDetail | null>(`intent-detail-${projectId.value}-${intentId.value}`, () => projectId.value && intentId.value
  ? requestFetch(`/api/console/projects/${projectId.value}/intents/${encodeURIComponent(intentId.value)}`)
  : Promise.resolve(null), { watch: [projectId] })

const pollAttempt = ref(0)
const polling = ref(false)
let pollTimer: ReturnType<typeof setTimeout> | undefined
let stopped = false

const latestSubmission = computed(() => intent.value?.submissions?.at(-1))
const explorerUrl = computed(() => transactionExplorerUrl(intent.value?.network || 'devnet', latestSubmission.value?.transactionHash))
const stateLabel = computed(() => intent.value?.state?.replaceAll('_', ' ') || 'Unknown')
const isTerminal = computed(() => Boolean(intent.value && terminalStates.has(intent.value.state)))
const eventRows = computed(() => intent.value?.events?.map(event => ({
  ...event,
  label: event.toState.replaceAll('_', ' '),
  fromLabel: event.fromState?.replaceAll('_', ' ') || 'Created'
})) || [])

function clearPoll() {
  if (pollTimer) clearTimeout(pollTimer)
  pollTimer = undefined
}

function schedulePoll() {
  if (stopped || isTerminal.value || !intent.value) return
  clearPoll()
  pollAttempt.value += 1
  const delay = Math.min(15_000, 1_500 + pollAttempt.value * 750)
  pollTimer = setTimeout(() => void poll(), delay)
}

async function poll() {
  if (stopped || !intent.value || polling.value) return
  polling.value = true
  try {
    await refresh()
  } finally {
    polling.value = false
    schedulePoll()
  }
}

onMounted(() => {
  schedulePoll()
})

onBeforeUnmount(() => {
  stopped = true
  clearPoll()
})
</script>

<template>
  <div class="mx-auto max-w-5xl">
    <ConsolePageHeader
      eyebrow="Transaction detail"
      :title="intent ? `Intent ${intent.id.slice(0, 8)}…` : 'Transaction detail'"
      description="Live state from the authenticated project record, including every state transition and submission attempt."
    >
      <UButton
        to="/app/intents"
        label="All transactions"
        icon="i-lucide-arrow-left"
        color="neutral"
        variant="outline"
      />
    </ConsolePageHeader>

    <UAlert
      v-if="error"
      class="mb-6"
      color="error"
      title="Transaction detail is unavailable"
      :description="error.message"
    >
      <template #actions>
        <UButton
          label="Retry"
          color="error"
          variant="soft"
          @click="() => refresh()"
        />
      </template>
    </UAlert>
    <div
      v-else-if="status === 'pending' && !intent"
      class="space-y-4"
    >
      <USkeleton class="h-44 rounded-2xl" />
      <USkeleton class="h-72 rounded-2xl" />
    </div>
    <template v-else-if="intent">
      <section class="acme-card overflow-hidden">
        <div class="flex flex-wrap items-start justify-between gap-4 border-b border-[#D9E5F7] p-6 sm:p-8">
          <div>
            <div class="flex flex-wrap items-center gap-2">
              <IntentStatus :status="intent.state" />
              <span
                v-if="polling"
                class="inline-flex items-center gap-1.5 text-xs text-[#62789C]"
              ><UIcon
                name="i-lucide-refresh-cw"
                class="size-3.5 animate-spin"
              />Updating</span>
            </div>
            <p class="mt-4 break-all font-mono text-xs text-[#62789C]">
              {{ intent.id }}
            </p>
            <p class="mt-2 text-sm text-[#62789C]">
              Created {{ formatDateTime(intent.createdAt) }} · expires {{ formatDateTime(intent.expiresAt) }}
            </p>
          </div>
          <div class="flex flex-wrap gap-2">
            <UButton
              label="Refresh"
              icon="i-lucide-refresh-cw"
              color="neutral"
              variant="ghost"
              :loading="polling"
              @click="poll"
            />
            <UButton
              v-if="explorerUrl"
              :href="explorerUrl"
              target="_blank"
              rel="noopener noreferrer"
              label="Open Explorer"
              icon="i-lucide-external-link"
              color="neutral"
              variant="outline"
            />
          </div>
        </div>
        <div class="grid gap-4 p-6 sm:grid-cols-2 lg:grid-cols-4 sm:p-8">
          <div class="rounded-xl bg-[#F7FAFF] p-4">
            <p class="text-xs text-[#62789C]">
              Account
            </p>
            <p class="mt-2 break-all font-mono text-xs">
              {{ shortenAddress(intent.accountAddress) }}
            </p>
          </div>
          <div class="rounded-xl bg-[#F7FAFF] p-4">
            <p class="text-xs text-[#62789C]">
              Operation
            </p>
            <p class="mt-2 font-medium">
              {{ String(intent.canonicalTransaction.TransactionType || 'Transaction') }}
            </p>
          </div>
          <div class="rounded-xl bg-[#F7FAFF] p-4">
            <p class="text-xs text-[#62789C]">
              Sponsored fee
            </p>
            <p class="mt-2 font-medium">
              {{ formatDropsAsXrp(intent.estimatedFeeDrops) }}
            </p>
          </div>
          <div class="rounded-xl bg-[#F7FAFF] p-4">
            <p class="text-xs text-[#62789C]">
              Network
            </p>
            <p class="mt-2 font-medium capitalize">
              {{ intent.network }} · {{ intent.networkId }}
            </p>
          </div>
        </div>
      </section>

      <UAlert
        v-if="intent.state === 'awaiting_user_signature'"
        class="mt-6"
        color="warning"
        variant="subtle"
        icon="i-lucide-pen-line"
        title="This intent is waiting for the wallet signature"
        description="Return to the browser tab that created the intent to review and sign it. A deep link cannot recreate the short-lived grant token."
      >
        <template #actions>
          <UButton
            to="/app/first-payment"
            label="Open guided payment"
            color="warning"
            variant="soft"
          />
        </template>
      </UAlert>
      <UAlert
        v-else-if="intent.state === 'validated'"
        class="mt-6"
        color="success"
        variant="subtle"
        icon="i-lucide-circle-check"
        title="Validated on Devnet"
        description="The latest submission has been confirmed by a validated ledger."
      />
      <UAlert
        v-else-if="isTerminal"
        class="mt-6"
        color="error"
        variant="subtle"
        icon="i-lucide-triangle-alert"
        title="This intent will not advance further"
        :description="`The terminal state is ${stateLabel}. Create a fresh intent if you need to retry.`"
      />

      <div class="mt-6 grid gap-6 lg:grid-cols-[1.1fr_.9fr]">
        <section class="acme-card overflow-hidden">
          <div class="border-b border-[#D9E5F7] px-5 py-4">
            <h2 class="font-semibold">
              State history
            </h2>
            <p class="mt-1 text-xs text-[#62789C]">
              Durable event records from the sponsorship state machine.
            </p>
          </div>
          <div
            v-if="eventRows.length"
            class="divide-y divide-[#E9F0FA]"
          >
            <div
              v-for="event in eventRows"
              :key="event.id"
              class="flex gap-3 px-5 py-4"
            >
              <span class="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-[#DCEBFF] text-[#0A3DFF]"><UIcon
                name="i-lucide-check"
                class="size-3.5"
              /></span>
              <div class="min-w-0 flex-1">
                <p class="text-sm font-medium capitalize">
                  {{ event.label }}
                </p>
                <p class="mt-1 text-xs text-[#62789C]">
                  {{ event.fromLabel }} → {{ event.label }} · {{ event.actor }}
                </p>
              </div>
              <time class="shrink-0 text-right text-[11px] text-[#62789C]">{{ formatDateTime(event.createdAt) }}</time>
            </div>
          </div>
          <div
            v-else
            class="p-6 text-sm text-[#62789C]"
          >
            No state events were returned.
          </div>
        </section>

        <section class="acme-card overflow-hidden">
          <div class="border-b border-[#D9E5F7] px-5 py-4">
            <h2 class="font-semibold">
              Submission attempts
            </h2>
            <p class="mt-1 text-xs text-[#62789C]">
              A transaction hash is shown only when the backend records one.
            </p>
          </div>
          <div
            v-if="intent.submissions.length"
            class="divide-y divide-[#E9F0FA]"
          >
            <div
              v-for="submission in intent.submissions"
              :key="submission.attempt"
              class="px-5 py-4"
            >
              <div class="flex items-center justify-between gap-3">
                <p class="text-sm font-medium">
                  Attempt {{ submission.attempt }}
                </p>
                <UBadge
                  :label="submission.validatedAt ? 'Validated' : submission.engineResult || 'Submitted'"
                  :color="submission.validatedAt ? 'success' : submission.engineResult && submission.engineResult !== 'tesSUCCESS' ? 'error' : 'info'"
                  variant="subtle"
                />
              </div>
              <p class="mt-2 break-all font-mono text-[11px] text-[#62789C]">
                {{ submission.transactionHash }}
              </p>
              <p class="mt-2 text-xs text-[#62789C]">
                Ledger {{ submission.ledgerIndex || 'pending' }} · {{ formatDateTime(submission.validatedAt || submission.createdAt) }}
              </p>
            </div>
          </div>
          <div
            v-else
            class="p-6 text-sm text-[#62789C]"
          >
            No submission has been recorded yet. The intent may still be waiting for a wallet signature.
          </div>
        </section>
      </div>

      <section class="acme-card mt-6 overflow-hidden">
        <div class="border-b border-[#D9E5F7] px-5 py-4">
          <h2 class="font-semibold">
            Canonical transaction
          </h2>
          <p class="mt-1 break-all text-xs text-[#62789C]">
            Definition hash {{ intent.definitionsHash }} · canonical hash {{ intent.canonicalHash }}
          </p>
        </div>
        <pre class="max-h-[28rem] overflow-auto bg-[#071733] p-5 text-xs leading-5 text-[#DCEBFF]">{{ JSON.stringify(intent.canonicalTransaction, null, 2) }}</pre>
      </section>
    </template>
    <section
      v-else
      class="acme-card px-5 py-14 text-center"
    >
      <p class="font-medium">
        Transaction not found
      </p>
      <p class="mt-1 text-sm text-[#62789C]">
        The intent may have been removed or you may not have access to this project.
      </p>
      <UButton
        to="/app/intents"
        label="Back to transactions"
        class="mt-5"
      />
    </section>
  </div>
</template>
