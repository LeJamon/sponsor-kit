<script setup lang="ts">
import { formatDateTime } from '~/utils/format'
import { dropsToXrp, policyDocumentFromForm, policyFormFromDocument, type PolicyDocument } from '~/utils/policy'

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

const requestFetch = useRequestFetch()
const toast = useToast()

definePageMeta({ layout: 'dashboard' })

const createOpen = useState('project-creation-open', () => false)
const { selected, projectId, data: context } = await useConsoleProject()
const policyKey = `project-sponsorship-policies-${projectId.value || 'none'}`
const { data: policies, status, error, refresh } = await useAsyncData<PolicyRow[]>(policyKey, () => projectId.value
  ? requestFetch<PolicyRow[]>(`/api/console/projects/${projectId.value}/policies`)
  : Promise.resolve([]), { watch: [projectId] })

const canManage = computed(() => ['owner', 'admin'].includes(selected.value?.role || ''))
const mutationId = ref<string | null>(null)
const mutationError = ref('')
const copiedPolicyId = ref<string | null>(null)
const archiveTarget = ref<PolicyRow | null>(null)
const archiveOpen = computed({
  get: () => Boolean(archiveTarget.value),
  set: (value) => {
    if (!value) archiveTarget.value = null
  }
})

function policyDocument(policy: PolicyRow): PolicyDocument {
  const form = policyFormFromDocument(policy.document)
  return policyDocumentFromForm(form)
}

function statusColor(status: PolicyRow['status']) {
  return status === 'active' ? 'success' : status === 'paused' ? 'warning' : status === 'draft' ? 'info' : 'neutral'
}

async function copyPolicyId(policyId: string) {
  try {
    await navigator.clipboard.writeText(policyId)
    copiedPolicyId.value = policyId
    window.setTimeout(() => {
      if (copiedPolicyId.value === policyId) copiedPolicyId.value = null
    }, 1800)
  } catch {
    copiedPolicyId.value = null
    toast.add({ title: 'Could not copy policy ID', color: 'error', icon: 'i-lucide-triangle-alert' })
  }
}

async function changeStatus(policy: PolicyRow, nextStatus: 'active' | 'paused' | 'archived') {
  if (!projectId.value || !canManage.value || mutationId.value) return
  mutationId.value = policy.id
  mutationError.value = ''
  try {
    await $fetch(`/api/console/projects/${projectId.value}/policies/${policy.id}`, { method: 'PATCH', body: { status: nextStatus } })
    archiveTarget.value = null
    await refresh()
  } catch (requestError: unknown) {
    mutationError.value = requestError instanceof Error ? requestError.message : 'Policy status could not be updated.'
  } finally {
    mutationId.value = null
  }
}

function confirmArchive(policy: PolicyRow) {
  if (!canManage.value || mutationId.value) return
  mutationError.value = ''
  archiveTarget.value = policy
}
</script>

<template>
  <div class="mx-auto max-w-6xl">
    <div class="mb-6 flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
      <h1 class="text-2xl font-bold tracking-tight sm:text-3xl">
        Sponsorship
      </h1>
      <div class="flex flex-wrap gap-2">
        <UButton
          label="Refresh"
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="outline"
          :loading="status === 'pending'"
          @click="refresh()"
        />
        <UButton
          v-if="canManage && projectId"
          to="/app/sponsorship/new"
          label="New policy"
          icon="i-lucide-plus"
        />
      </div>
    </div>

    <SponsorshipTabs />

    <section
      v-if="!context?.projects.length"
      class="rounded-2xl border border-[#D9E5F7] bg-white px-5 py-14 text-center"
    >
      <UIcon
        name="i-lucide-folder-plus"
        class="size-8 text-[#0A3DFF]"
      />
      <h2 class="mt-4 font-semibold">
        Create a project to manage policies
      </h2>
      <p class="mt-1 text-sm text-[#62789C]">
        Sponsorship policies belong to a project.
      </p>
      <UButton
        label="Create project"
        icon="i-lucide-plus"
        class="mt-5"
        @click="createOpen = true"
      />
    </section>

    <UAlert
      v-else-if="error"
      color="error"
      variant="subtle"
      title="Policies are unavailable"
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

    <section
      v-else
      class="overflow-hidden rounded-2xl border border-[#D9E5F7] bg-white"
    >
      <div
        v-if="status === 'pending' && !policies"
        class="space-y-3 p-5"
      >
        <USkeleton
          v-for="index in 4"
          :key="index"
          class="h-16 rounded-xl"
        />
      </div>
      <div
        v-else-if="policies?.length"
        class="divide-y divide-[#E9F0FA]"
      >
        <div
          class="hidden items-center gap-4 bg-[#F7FAFF] px-5 py-3 text-xs font-medium uppercase tracking-wide text-[#62789C] lg:grid lg:grid-cols-[minmax(12rem,1.2fr)_minmax(10rem,1fr)_6rem_7rem_minmax(12rem,1fr)_auto]"
        >
          <span>Policy</span>
          <span>Limits</span>
          <span>Version</span>
          <span>Status</span>
          <span>Published</span>
          <span />
        </div>
        <div
          v-for="policy in policies"
          :key="policy.id"
          class="grid gap-4 px-5 py-5 transition hover:bg-[#F7FAFF] lg:grid-cols-[minmax(12rem,1.2fr)_minmax(10rem,1fr)_6rem_7rem_minmax(12rem,1fr)_auto] lg:items-center"
        >
          <div class="min-w-0">
            <NuxtLink
              :to="`/app/sponsorship/policies/${policy.id}`"
              class="font-medium text-[#10244A] hover:text-[#0A3DFF]"
            >
              {{ policy.name }}
            </NuxtLink>
            <div class="mt-1 flex items-center gap-2 text-xs text-[#62789C]">
              <span class="truncate font-mono">{{ policy.id }}</span>
              <UButton
                :label="copiedPolicyId === policy.id ? 'Copied' : undefined"
                :icon="copiedPolicyId === policy.id ? 'i-lucide-check' : 'i-lucide-copy'"
                color="neutral"
                variant="ghost"
                size="xs"
                :aria-label="`Copy policy ID ${policy.id}`"
                @click="copyPolicyId(policy.id)"
              />
            </div>
          </div>
          <div class="text-sm">
            <p>Fee {{ dropsToXrp(String(policyDocument(policy).maximumFeeDrops)) }} XRP</p>
            <p class="mt-1 text-xs text-[#62789C]">
              Reserve {{ dropsToXrp(String(policyDocument(policy).maximumReserveDrops)) }} XRP
            </p>
          </div>
          <span class="text-sm text-[#62789C]">v{{ policy.version }}</span>
          <UBadge
            :label="policy.status"
            :color="statusColor(policy.status)"
            variant="subtle"
            class="w-fit capitalize"
          />
          <div class="text-xs text-[#62789C]">
            <p>{{ formatDateTime(policy.publishedAt || policy.createdAt) }}</p>
            <p class="mt-1 truncate">
              {{ policyDocument(policy).allowedTransactionTypes.join(', ') }}
            </p>
          </div>
          <div class="flex flex-wrap gap-1 lg:justify-end">
            <UButton
              v-if="canManage && policy.status === 'active'"
              label="Pause"
              color="warning"
              variant="soft"
              size="sm"
              :loading="mutationId === policy.id"
              @click="changeStatus(policy, 'paused')"
            />
            <UButton
              v-else-if="canManage && policy.status !== 'archived'"
              label="Activate"
              color="success"
              variant="soft"
              size="sm"
              :loading="mutationId === policy.id"
              @click="changeStatus(policy, 'active')"
            />
            <UButton
              v-if="canManage && policy.status !== 'archived'"
              label="Archive"
              color="neutral"
              variant="ghost"
              size="sm"
              :disabled="Boolean(mutationId)"
              @click="confirmArchive(policy)"
            />
          </div>
        </div>
      </div>
      <div
        v-else
        class="px-5 py-14 text-center"
      >
        <h2 class="font-medium">
          No sponsorship policies
        </h2>
        <p class="mt-1 text-sm text-[#62789C]">
          Create a policy before accepting intents.
        </p>
        <UButton
          v-if="canManage"
          to="/app/sponsorship/new"
          label="Create policy"
          icon="i-lucide-plus"
          class="mt-5"
        />
      </div>
    </section>

    <UAlert
      v-if="mutationError"
      class="mt-5"
      color="error"
      variant="subtle"
      title="Policy status could not be updated"
      :description="mutationError"
    />

    <UModal
      v-model:open="archiveOpen"
      title="Archive policy?"
      description="Archived versions stay available for audit history and cannot approve new intents."
      :dismissible="!mutationId"
      :close="!mutationId"
      :ui="{ content: 'max-w-md rounded-3xl', overlay: 'backdrop-blur-sm' }"
    >
      <template #body>
        <div class="space-y-5">
          <p class="text-sm text-[#62789C]">
            Archive <strong class="text-[#10244A]">{{ archiveTarget?.name }} · v{{ archiveTarget?.version }}</strong>?
          </p>
          <div class="flex justify-end gap-2">
            <UButton
              label="Cancel"
              color="neutral"
              variant="ghost"
              :disabled="Boolean(mutationId)"
              @click="archiveTarget = null"
            />
            <UButton
              label="Archive policy"
              color="error"
              :loading="Boolean(mutationId)"
              :disabled="!archiveTarget"
              @click="archiveTarget && changeStatus(archiveTarget, 'archived')"
            />
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
