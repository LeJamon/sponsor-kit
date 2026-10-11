<script setup lang="ts">
import { formatDateTime } from '~/utils/format'
import { dropsToXrp, policyDocumentFromForm, policyFormFromDocument, type PolicyDocument, type PolicyForm } from '~/utils/policy'

type PolicyRow = {
  id: string
  projectId: string
  name: string
  version: number
  status: 'draft' | 'active' | 'paused' | 'archived'
  document: Record<string, unknown>
  documentHash: string
  publishedAt: string | null
  createdAt: string
}
type ProtocolResponse = { definitions?: { TRANSACTION_TYPES?: Record<string, unknown> } }

const requestFetch = useRequestFetch()
const route = useRoute()
const toast = useToast()

definePageMeta({ layout: 'dashboard' })

const { selected, projectId, data: context } = await useConsoleProject()
const policyId = computed(() => String(route.params.policyId || ''))
const canManage = computed(() => ['owner', 'admin'].includes(selected.value?.role || ''))
const policyKey = `project-sponsorship-policy-detail-${projectId.value || 'none'}-${policyId.value || 'none'}`
const { data: policies, status, error, refresh } = await useAsyncData<PolicyRow[]>(policyKey, () => projectId.value
  ? requestFetch<PolicyRow[]>(`/api/console/projects/${projectId.value}/policies`)
  : Promise.resolve([]), { watch: [projectId, policyId] })
const protocolKey = `project-sponsorship-policy-detail-protocol-${projectId.value || 'none'}`
const { data: protocol } = await useAsyncData<ProtocolResponse | null>(protocolKey, () => projectId.value
  ? requestFetch<ProtocolResponse>(`/api/console/projects/${projectId.value}/protocol`, { timeout: 3000 }).catch(() => null)
  : Promise.resolve(null), { watch: [projectId], server: false })

const policy = computed(() => policies.value?.find(item => item.id === policyId.value) || null)
const versions = computed(() => policy.value
  ? (policies.value || []).filter(item => item.name === policy.value?.name).sort((left, right) => right.version - left.version)
  : [])
const transactionTypeOptions = computed(() => {
  const configured = (policies.value || []).flatMap((item) => {
    const types = item.document.allowedTransactionTypes
    return Array.isArray(types) ? types.filter((type): type is string => typeof type === 'string') : []
  })
  const protocolTypes = Object.keys(protocol.value?.definitions?.TRANSACTION_TYPES || {})
    .filter(type => !['EnableAmendment', 'SetFee', 'UNLModify'].includes(type))
  return [...new Set([...protocolTypes, ...configured])]
})

const editOpen = ref(false)
const form = ref<PolicyForm>(emptyForm())
const saving = ref(false)
const statusMutation = ref(false)
const errorMessage = ref('')
const copied = ref(false)
const archiveOpen = ref(false)

function emptyForm() {
  return {
    maximumFeeXrp: '0.01',
    maximumReserveXrp: '1',
    maximumIntentsPerWalletPerDay: '100',
    intentTtlSeconds: '300',
    transactionTypes: [],
    allowedDestinations: '',
    allowedFields: ''
  } satisfies PolicyForm
}

function currentDocument(row: PolicyRow): PolicyDocument {
  return policyDocumentFromForm(policyFormFromDocument(row.document))
}

watch(policy, (value) => {
  if (!value) return
  form.value = policyFormFromDocument(value.document)
  editOpen.value = false
  errorMessage.value = ''
}, { immediate: true })

function requestErrorMessage(requestError: unknown, fallback: string) {
  const failure = requestError as { data?: { statusMessage?: string }, statusMessage?: string }
  return failure.data?.statusMessage || failure.statusMessage || (requestError instanceof Error ? requestError.message : fallback)
}

function statusColor(value: PolicyRow['status']) {
  return value === 'active' ? 'success' : value === 'paused' ? 'warning' : value === 'draft' ? 'info' : 'neutral'
}

function startEditing() {
  if (!policy.value || !canManage.value) return
  form.value = policyFormFromDocument(policy.value.document)
  errorMessage.value = ''
  editOpen.value = true
}

function cancelEditing() {
  if (policy.value) form.value = policyFormFromDocument(policy.value.document)
  errorMessage.value = ''
  editOpen.value = false
}

async function publishVersion() {
  if (!projectId.value || !policy.value || !canManage.value || saving.value) return
  errorMessage.value = ''
  let document
  try {
    document = policyDocumentFromForm(form.value)
  } catch (conversionError: unknown) {
    errorMessage.value = conversionError instanceof Error ? conversionError.message : 'Check the policy values before publishing.'
    return
  }
  saving.value = true
  try {
    const created = await $fetch<{ id: string }>(`/api/console/projects/${projectId.value}/policies`, {
      method: 'POST',
      body: { name: policy.value.name, activate: true, document }
    })
    await navigateTo(`/app/sponsorship/policies/${created.id}`)
  } catch (requestError: unknown) {
    errorMessage.value = requestErrorMessage(requestError, 'New policy version could not be published.')
  } finally {
    saving.value = false
  }
}

async function changeStatus(nextStatus: 'active' | 'paused' | 'archived') {
  if (!projectId.value || !policy.value || !canManage.value || statusMutation.value) return
  statusMutation.value = true
  errorMessage.value = ''
  try {
    await $fetch(`/api/console/projects/${projectId.value}/policies/${policy.value.id}`, { method: 'PATCH', body: { status: nextStatus } })
    archiveOpen.value = false
    await refresh()
  } catch (requestError: unknown) {
    errorMessage.value = requestErrorMessage(requestError, 'Policy status could not be updated.')
  } finally {
    statusMutation.value = false
  }
}

async function copyPolicyId() {
  if (!policy.value) return
  try {
    await navigator.clipboard.writeText(policy.value.id)
    copied.value = true
    window.setTimeout(() => {
      copied.value = false
    }, 1800)
  } catch {
    copied.value = false
    toast.add({ title: 'Could not copy policy ID', color: 'error', icon: 'i-lucide-triangle-alert' })
  }
}
</script>

<template>
  <div class="mx-auto max-w-5xl">
    <SponsorshipTabs />

    <UAlert
      v-if="!context?.projects.length"
      class="mb-6"
      color="warning"
      variant="subtle"
      title="No project selected"
      description="Create a project before opening a sponsorship policy."
    />
    <UAlert
      v-else-if="error"
      class="mb-6"
      color="error"
      variant="subtle"
      title="Policy is unavailable"
      :description="error.message"
    >
      <template #actions>
        <UButton
          label="Retry"
          color="error"
          variant="soft"
          @click="refresh()"
        />
      </template>
    </UAlert>

    <div
      v-else-if="status === 'pending' && !policy"
      class="space-y-4"
    >
      <USkeleton class="h-24 rounded-2xl" />
      <USkeleton class="h-72 rounded-2xl" />
    </div>

    <template v-else-if="policy">
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div class="min-w-0">
          <NuxtLink
            to="/app/sponsorship"
            class="inline-flex items-center gap-1 text-sm font-medium text-[#62789C] hover:text-[#0A3DFF]"
          >
            <UIcon name="i-lucide-arrow-left" /> Policies
          </NuxtLink>
          <div class="mt-4 flex flex-wrap items-center gap-2">
            <h1 class="text-2xl font-bold tracking-tight sm:text-3xl">
              {{ policy.name }}
            </h1>
            <UBadge
              :label="`v${policy.version}`"
              color="neutral"
              variant="subtle"
            />
            <UBadge
              :label="policy.status"
              :color="statusColor(policy.status)"
              variant="subtle"
              class="capitalize"
            />
          </div>
          <div class="mt-2 flex flex-wrap items-center gap-2 text-xs text-[#62789C]">
            <span class="break-all font-mono">{{ policy.id }}</span>
            <UButton
              :label="copied ? 'Copied' : 'Copy ID'"
              :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'"
              color="neutral"
              variant="ghost"
              size="xs"
              @click="copyPolicyId"
            />
          </div>
        </div>
        <div class="flex flex-wrap gap-2">
          <UButton
            v-if="canManage && policy.status === 'active'"
            label="Pause"
            color="warning"
            variant="soft"
            :loading="statusMutation"
            :disabled="saving"
            @click="changeStatus('paused')"
          />
          <UButton
            v-else-if="canManage && policy.status !== 'archived'"
            label="Activate"
            color="success"
            variant="soft"
            :loading="statusMutation"
            :disabled="saving"
            @click="changeStatus('active')"
          />
          <UButton
            v-if="canManage && policy.status !== 'archived'"
            label="Archive"
            color="neutral"
            variant="outline"
            :disabled="statusMutation || saving"
            @click="archiveOpen = true"
          />
          <UButton
            v-if="canManage"
            :label="editOpen ? 'Close editor' : 'Edit version'"
            :icon="editOpen ? 'i-lucide-x' : 'i-lucide-pencil'"
            color="neutral"
            variant="outline"
            :disabled="statusMutation || saving"
            @click="editOpen ? cancelEditing() : startEditing()"
          />
        </div>
      </div>

      <UAlert
        v-if="!canManage"
        class="mt-6"
        color="info"
        variant="subtle"
        title="Read-only access"
        description="Only project owners and admins can change policy status or publish a new version."
      />

      <section
        v-if="!editOpen"
        class="mt-6 overflow-hidden rounded-2xl border border-[#D9E5F7] bg-white"
      >
        <div class="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4 sm:p-6">
          <div>
            <p class="text-xs text-[#62789C]">
              Maximum fee
            </p>
            <p class="mt-1 font-semibold">
              {{ dropsToXrp(currentDocument(policy).maximumFeeDrops) }} XRP
            </p>
          </div>
          <div>
            <p class="text-xs text-[#62789C]">
              Maximum reserve
            </p>
            <p class="mt-1 font-semibold">
              {{ dropsToXrp(currentDocument(policy).maximumReserveDrops) }} XRP
            </p>
          </div>
          <div>
            <p class="text-xs text-[#62789C]">
              Wallet intents / UTC day
            </p>
            <p class="mt-1 font-semibold">
              {{ currentDocument(policy).maximumIntentsPerWalletPerDay }}
            </p>
          </div>
          <div>
            <p class="text-xs text-[#62789C]">
              Intent TTL
            </p>
            <p class="mt-1 font-semibold">
              {{ currentDocument(policy).intentTtlSeconds }} sec
            </p>
          </div>
        </div>
        <div class="border-t border-[#D9E5F7] px-5 py-4 sm:px-6">
          <p class="text-xs text-[#62789C]">
            Allowed transaction types
          </p>
          <p class="mt-1 text-sm">
            {{ currentDocument(policy).allowedTransactionTypes.join(', ') }}
          </p>
        </div>
        <div class="grid gap-4 border-t border-[#D9E5F7] px-5 py-4 text-sm sm:grid-cols-2 sm:px-6">
          <div>
            <p class="text-xs text-[#62789C]">
              Allowed destinations
            </p>
            <p class="mt-1 whitespace-pre-line break-all">
              {{ currentDocument(policy).allowedDestinations.length ? currentDocument(policy).allowedDestinations.join('\n') : 'Any classic XRPL address' }}
            </p>
          </div>
          <div>
            <p class="text-xs text-[#62789C]">
              Allowed fields
            </p>
            <p class="mt-1 whitespace-pre-line">
              {{ currentDocument(policy).allowedFields.length ? currentDocument(policy).allowedFields.join(', ') : 'All supported fields' }}
            </p>
          </div>
        </div>
        <p class="border-t border-[#D9E5F7] px-5 py-3 text-xs text-[#62789C] sm:px-6">
          Created {{ formatDateTime(policy.createdAt) }} · published {{ formatDateTime(policy.publishedAt) }} · wallet proof required
        </p>
      </section>

      <form
        v-if="editOpen && canManage"
        class="mt-6 space-y-6"
        @submit.prevent="publishVersion"
      >
        <p class="text-sm text-[#62789C]">
          Publishing creates a new active version and preserves this snapshot.
        </p>
        <SponsorshipPolicyEditor
          v-model="form"
          :transaction-type-options="transactionTypeOptions"
          :disabled="saving"
        />
        <UAlert
          v-if="errorMessage"
          color="error"
          variant="subtle"
          title="New version could not be published"
          :description="errorMessage"
        />
        <div class="flex flex-wrap justify-end gap-2">
          <UButton
            type="button"
            label="Cancel"
            color="neutral"
            variant="ghost"
            :disabled="saving"
            @click="cancelEditing"
          />
          <UButton
            type="submit"
            label="Publish new version"
            icon="i-lucide-shield-check"
            :loading="saving"
            :disabled="!form.transactionTypes.length"
          />
        </div>
      </form>

      <section class="mt-6 overflow-hidden rounded-2xl border border-[#D9E5F7] bg-white">
        <div class="border-b border-[#D9E5F7] px-5 py-4 sm:px-6">
          <h2 class="font-semibold">
            Versions
          </h2>
        </div>
        <div class="divide-y divide-[#E9F0FA]">
          <NuxtLink
            v-for="version in versions"
            :key="version.id"
            :to="`/app/sponsorship/policies/${version.id}`"
            class="flex flex-wrap items-center justify-between gap-3 px-5 py-4 text-sm hover:bg-[#F7FAFF] sm:px-6"
            :class="version.id === policy.id ? 'bg-[#F7FAFF]' : ''"
          >
            <span class="flex items-center gap-2">
              <span class="font-medium">v{{ version.version }}</span>
              <UBadge
                :label="version.status"
                :color="statusColor(version.status)"
                variant="subtle"
                class="capitalize"
              />
              <span
                v-if="version.id === policy.id"
                class="text-xs text-[#62789C]"
              >Current</span>
            </span>
            <span class="text-xs text-[#62789C]">{{ formatDateTime(version.publishedAt || version.createdAt) }}</span>
          </NuxtLink>
        </div>
      </section>
    </template>

    <section
      v-else
      class="rounded-2xl border border-[#D9E5F7] bg-white px-5 py-14 text-center"
    >
      <h2 class="font-medium">
        Policy not found
      </h2>
      <p class="mt-1 text-sm text-[#62789C]">
        This policy may belong to another project or have been removed.
      </p>
      <UButton
        to="/app/sponsorship"
        label="Back to policies"
        class="mt-5"
      />
    </section>

    <UAlert
      v-if="errorMessage && !editOpen"
      class="mt-5"
      color="error"
      variant="subtle"
      title="Policy status could not be updated"
      :description="errorMessage"
    />

    <UModal
      v-model:open="archiveOpen"
      title="Archive policy?"
      description="Archived versions stay available for audit history and cannot approve new intents."
      :dismissible="!statusMutation"
      :close="!statusMutation"
      :ui="{ content: 'max-w-md rounded-3xl', overlay: 'backdrop-blur-sm' }"
    >
      <template #body>
        <div class="space-y-5">
          <p class="text-sm text-[#62789C]">
            Archive <strong class="text-[#10244A]">{{ policy?.name }} · v{{ policy?.version }}</strong>?
          </p>
          <div class="flex justify-end gap-2">
            <UButton
              label="Cancel"
              color="neutral"
              variant="ghost"
              :disabled="statusMutation"
              @click="archiveOpen = false"
            />
            <UButton
              label="Archive policy"
              color="error"
              :loading="statusMutation"
              @click="changeStatus('archived')"
            />
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
