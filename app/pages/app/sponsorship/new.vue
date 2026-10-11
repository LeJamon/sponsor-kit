<script setup lang="ts">
import { emptyPolicyForm, policyDocumentFromForm, type PolicyForm } from '~/utils/policy'

type PolicyRow = { document: Record<string, unknown> }
type ProtocolResponse = { definitions?: { TRANSACTION_TYPES?: Record<string, unknown> } }

const requestFetch = useRequestFetch()

definePageMeta({ layout: 'dashboard' })

const createOpen = useState('project-creation-open', () => false)
const { selected, projectId, data: context } = await useConsoleProject()
const canManage = computed(() => ['owner', 'admin'].includes(selected.value?.role || ''))
const policyKey = `project-sponsorship-policy-editor-${projectId.value || 'none'}`
const { data: policies, status: policyStatus, error: policyError } = await useAsyncData<PolicyRow[]>(policyKey, () => projectId.value
  ? requestFetch<PolicyRow[]>(`/api/console/projects/${projectId.value}/policies`)
  : Promise.resolve([]), { watch: [projectId] })
const protocolKey = `project-sponsorship-policy-protocol-${projectId.value || 'none'}`
const { data: protocol } = await useAsyncData<ProtocolResponse | null>(protocolKey, () => projectId.value
  ? requestFetch<ProtocolResponse>(`/api/console/projects/${projectId.value}/protocol`, { timeout: 3000 }).catch(() => null)
  : Promise.resolve(null), { watch: [projectId], server: false })

const transactionTypeOptions = computed(() => {
  const configured = (policies.value || []).flatMap(policy => Array.isArray(policy.document.allowedTransactionTypes)
    ? policy.document.allowedTransactionTypes.filter((item): item is string => typeof item === 'string')
    : [])
  const transactionDefinitions = protocol.value?.definitions?.TRANSACTION_TYPES || {}
  const protocolTypes = Object.entries(transactionDefinitions)
    .filter(([type, code]) => typeof code === 'number' && code >= 0 && !['EnableAmendment', 'SetFee', 'UNLModify'].includes(type))
    .map(([type]) => type)
  const values = [...new Set([...protocolTypes, ...configured])]
  return values.length ? values : ['Payment']
})
const form = ref<PolicyForm>(emptyPolicyForm())
const name = ref('')
const saving = ref(false)
const errorMessage = ref('')

const defaultsApplied = ref(false)
watch([transactionTypeOptions, policyStatus], ([options, policiesLoading]) => {
  if (defaultsApplied.value || policiesLoading === 'pending') return
  form.value = { ...form.value, transactionTypes: [...options] }
  defaultsApplied.value = true
}, { immediate: true })

function requestErrorMessage(requestError: unknown, fallback: string) {
  const failure = requestError as { data?: { statusMessage?: string }, statusMessage?: string }
  return failure.data?.statusMessage || failure.statusMessage || (requestError instanceof Error ? requestError.message : fallback)
}

async function createPolicy() {
  if (!projectId.value || !canManage.value || saving.value) return
  errorMessage.value = ''
  let document
  try {
    document = policyDocumentFromForm(form.value)
  } catch (error: unknown) {
    errorMessage.value = error instanceof Error ? error.message : 'Check the policy values before publishing.'
    return
  }
  if (name.value.trim().length < 2 || name.value.trim().length > 80) {
    errorMessage.value = 'Policy name must be between 2 and 80 characters.'
    return
  }
  saving.value = true
  try {
    const created = await $fetch<{ id: string }>(`/api/console/projects/${projectId.value}/policies`, {
      method: 'POST',
      body: { name: name.value.trim(), activate: true, document }
    })
    await navigateTo(`/app/sponsorship/policies/${created.id}`)
  } catch (requestError: unknown) {
    errorMessage.value = requestErrorMessage(requestError, 'Policy could not be published.')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-4xl">
    <SponsorshipTabs />

    <div class="flex flex-wrap items-start justify-between gap-4">
      <div>
        <NuxtLink
          to="/app/sponsorship"
          class="inline-flex items-center gap-1 text-sm font-medium text-[#62789C] hover:text-[#0A3DFF]"
        >
          <UIcon name="i-lucide-arrow-left" /> Policies
        </NuxtLink>
        <h1 class="mt-4 text-2xl font-bold tracking-tight sm:text-3xl">
          New policy
        </h1>
      </div>
    </div>

    <section
      v-if="!context?.projects.length"
      class="mt-6 rounded-2xl border border-[#D9E5F7] bg-white px-5 py-14 text-center"
    >
      <h2 class="font-semibold">
        Create a project first
      </h2>
      <UButton
        label="Create project"
        icon="i-lucide-plus"
        class="mt-5"
        @click="createOpen = true"
      />
    </section>

    <UAlert
      v-else-if="!canManage"
      class="mt-6"
      color="warning"
      variant="subtle"
      title="Administrator access required"
      description="Only project owners and admins can publish sponsorship policies."
    />

    <template v-else>
      <UAlert
        v-if="policyError"
        class="mt-6"
        color="error"
        variant="subtle"
        title="Supported transaction types are unavailable"
        :description="policyError.message"
      />
      <form
        class="mt-6 space-y-6"
        @submit.prevent="createPolicy"
      >
        <section class="rounded-2xl border border-[#D9E5F7] bg-white p-5 sm:p-6">
          <UFormField
            label="Policy name"
          >
            <UInput
              v-model="name"
              class="w-full sm:max-w-xl"
              placeholder="Default sponsorship"
              minlength="2"
              maxlength="80"
              :disabled="saving"
              required
              autofocus
            />
          </UFormField>
        </section>

        <SponsorshipPolicyEditor
          v-model="form"
          :transaction-type-options="transactionTypeOptions"
          :disabled="saving || policyStatus === 'pending'"
        />

        <UAlert
          v-if="errorMessage"
          color="error"
          variant="subtle"
          title="Policy could not be published"
          :description="errorMessage"
        />

        <div class="flex flex-wrap justify-end gap-2">
          <UButton
            to="/app/sponsorship"
            label="Cancel"
            color="neutral"
            variant="ghost"
            :disabled="saving"
          />
          <UButton
            type="submit"
            label="Publish policy"
            icon="i-lucide-shield-check"
            :loading="saving"
            :disabled="!name.trim() || !form.transactionTypes.length"
          />
        </div>
      </form>
    </template>
  </div>
</template>
