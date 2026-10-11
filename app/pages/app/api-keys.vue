<script setup lang="ts">
import { formatDateTime } from '~/utils/format'

const requestFetch = useRequestFetch()

definePageMeta({ layout: 'dashboard' })
type ApiKeyScope = 'intents:create' | 'intents:read' | 'usage:read'
type ApiKey = {
  id: string
  name: string
  prefix: string
  scopes: ApiKeyScope[]
  expiresAt: string | null
  lastUsedAt: string | null
  revokedAt: string | null
  createdAt: string
}
const scopeItems: Array<{ label: string, value: ApiKeyScope }> = [
  { label: 'Create intents', value: 'intents:create' },
  { label: 'Read intents', value: 'intents:read' },
  { label: 'Read usage', value: 'usage:read' }
]
const { selected, projectId } = await useConsoleProject()
const { data: keys, status, error, refresh } = await useAsyncData<ApiKey[]>(`project-api-keys-${projectId.value}`, () => projectId.value ? requestFetch<ApiKey[]>(`/api/console/projects/${projectId.value}/api-keys`) : Promise.resolve([]), { watch: [projectId] })
const open = ref(false)
const name = ref('')
const scopes = ref<ApiKeyScope[]>(['intents:create', 'intents:read'])
const createdSecret = ref('')
const copyState = ref<'idle' | 'copied' | 'failed'>('idle')
const mutationError = ref('')
const saving = ref(false)
const revokeOpen = ref(false)
const revokeTarget = ref<ApiKey | null>(null)
const revokeError = ref('')
const revoking = ref(false)
const appOrigin = ref('')
const envCopyState = ref<'idle' | 'copied' | 'failed'>('idle')
let copyResetTimer: ReturnType<typeof setTimeout> | undefined
let envCopyTimer: ReturnType<typeof setTimeout> | undefined

const canManageKeys = computed(() => ['owner', 'admin'].includes(selected.value?.role || ''))
const copyLabel = computed(() => copyState.value === 'copied' ? 'Copied' : copyState.value === 'failed' ? 'Copy failed' : 'Copy')
const copyIcon = computed(() => copyState.value === 'copied' ? 'i-lucide-check' : copyState.value === 'failed' ? 'i-lucide-triangle-alert' : 'i-lucide-copy')
const copyAnnouncement = computed(() => copyState.value === 'copied' ? 'API key secret copied to clipboard.' : copyState.value === 'failed' ? 'Could not copy the API key secret. Select it and copy it manually.' : '')
const envCopyLabel = computed(() => envCopyState.value === 'copied' ? 'Copied' : envCopyState.value === 'failed' ? 'Copy failed' : 'Copy template')
const envCopyIcon = computed(() => envCopyState.value === 'copied' ? 'i-lucide-check' : envCopyState.value === 'failed' ? 'i-lucide-triangle-alert' : 'i-lucide-copy')
const envCopyAnnouncement = computed(() => envCopyState.value === 'copied' ? 'Integration template copied to clipboard.' : envCopyState.value === 'failed' ? 'Could not copy the integration template. Select it and copy it manually.' : '')

function requestMessage(error: unknown, fallback: string) {
  if (error && typeof error === 'object' && 'data' in error && error.data && typeof error.data === 'object' && 'statusMessage' in error.data) {
    return String(error.data.statusMessage)
  }
  return error instanceof Error ? error.message : fallback
}

async function createKey() {
  if (!projectId.value || !canManageKeys.value) return
  saving.value = true
  mutationError.value = ''
  try {
    const result = await $fetch<{ secret: string }>(`/api/console/projects/${projectId.value}/api-keys`, { method: 'POST', body: { name: name.value, scopes: scopes.value } })
    createdSecret.value = result.secret
    copyState.value = 'idle'
    name.value = ''
    open.value = false
    await refresh()
  } catch (requestError: unknown) {
    mutationError.value = requestMessage(requestError, 'API key creation failed.')
  } finally { saving.value = false }
}

function requestRevoke(key: ApiKey) {
  revokeTarget.value = key
  revokeError.value = ''
  revokeOpen.value = true
}

async function revokeKey() {
  const key = revokeTarget.value
  if (!projectId.value || !key || !canManageKeys.value || revoking.value) return
  revoking.value = true
  revokeError.value = ''
  try {
    await $fetch(`/api/console/projects/${projectId.value}/api-keys/${key.id}`, { method: 'DELETE' })
    revokeOpen.value = false
    revokeTarget.value = null
    await refresh()
  } catch (requestError: unknown) {
    revokeError.value = requestMessage(requestError, 'API key could not be revoked.')
  } finally {
    revoking.value = false
  }
}

async function copySecret() {
  if (!createdSecret.value) return
  if (copyResetTimer) clearTimeout(copyResetTimer)
  try {
    await navigator.clipboard.writeText(createdSecret.value)
    copyState.value = 'copied'
  } catch {
    copyState.value = 'failed'
  }
  copyResetTimer = setTimeout(() => {
    copyState.value = 'idle'
  }, copyState.value === 'copied' ? 2000 : 4000)
}

onBeforeUnmount(() => {
  if (copyResetTimer) clearTimeout(copyResetTimer)
  if (envCopyTimer) clearTimeout(envCopyTimer)
})

onMounted(() => {
  appOrigin.value = window.location.origin
})

async function copyEnvironmentTemplate() {
  const projectPublicId = projectId.value
  if (!projectPublicId) return
  const template = `ACME_BASE_URL=${appOrigin.value || window.location.origin}\nACME_PROJECT_ID=${projectPublicId}\nACME_API_KEY=paste-the-secret-shown-above`
  if (envCopyTimer) clearTimeout(envCopyTimer)
  try {
    await navigator.clipboard.writeText(template)
    envCopyState.value = 'copied'
  } catch {
    envCopyState.value = 'failed'
  }
  envCopyTimer = setTimeout(() => {
    envCopyState.value = 'idle'
  }, envCopyState.value === 'copied' ? 2_000 : 4_000)
}
</script>

<template>
  <div>
    <ConsolePageHeader
      title="API keys"
    >
      <UButton
        v-if="canManageKeys"
        label="Create API key"
        icon="i-lucide-plus"
        :aria-expanded="open"
        @click="open = !open"
      />
      <span
        v-else
        class="self-center text-xs text-[#62789C]"
      >Read-only access</span>
    </ConsolePageHeader>
    <section
      v-if="open && canManageKeys"
      class="acme-card mb-6 p-5"
    >
      <h2 class="font-semibold">
        New API key
      </h2><form
        class="mt-4 grid gap-4"
        @submit.prevent="createKey"
      >
        <UFormField label="Name">
          <UInput
            v-model="name"
            class="w-full"
            placeholder="Backend service"
            autocomplete="off"
          />
        </UFormField><UFormField label="Scopes">
          <UCheckboxGroup
            v-model="scopes"
            :items="scopeItems"
            orientation="horizontal"
            :ui="{ fieldset: 'flex-wrap gap-x-4 gap-y-2' }"
          />
        </UFormField><UAlert
          v-if="mutationError"
          color="error"
          variant="subtle"
          title="Could not create API key"
          :description="mutationError"
        /><div>
          <UButton
            type="submit"
            label="Create key"
            :loading="saving"
            :disabled="name.trim().length < 2 || !scopes.length"
          />
        </div>
      </form>
    </section>
    <UAlert
      v-if="createdSecret"
      class="mb-6"
      color="warning"
      variant="subtle"
      title="Copy this secret now"
      description="It cannot be retrieved again after this page is closed."
    >
      <template #actions>
        <div class="flex flex-wrap items-center gap-2">
          <code class="break-all text-xs">{{ createdSecret }}</code><UButton
            :label="copyLabel"
            :icon="copyIcon"
            :color="copyState === 'copied' ? 'success' : copyState === 'failed' ? 'error' : 'warning'"
            variant="soft"
            @click="copySecret"
          />
          <span
            class="sr-only"
            aria-live="polite"
          >{{ copyAnnouncement }}</span>
        </div>
      </template>
    </UAlert>
    <details class="acme-card group mb-6">
      <summary class="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 font-semibold marker:hidden">
        <span>Integration</span>
        <span class="text-xs font-medium text-[#62789C] group-open:hidden">Show</span>
        <span class="hidden text-xs font-medium text-[#62789C] group-open:inline">Hide</span>
      </summary>
      <div class="border-t border-[#D9E5F7] px-5 py-5">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <p class="max-w-2xl text-sm text-[#62789C]">
            Use the project key from your server environment. The secret is shown once when created.
          </p>
          <UButton
            :label="envCopyLabel"
            :icon="envCopyIcon"
            :color="envCopyState === 'failed' ? 'error' : 'neutral'"
            variant="outline"
            @click="copyEnvironmentTemplate"
          />
        </div>
        <pre class="mt-4 overflow-auto rounded-xl bg-[#071733] p-4 text-xs leading-5 text-[#DCEBFF]">ACME_BASE_URL={{ appOrigin || 'https://your-console.example' }}
ACME_PROJECT_ID={{ projectId || 'your_project_public_id' }}
ACME_API_KEY=paste-the-secret-shown-once</pre>
        <span
          class="sr-only"
          aria-live="polite"
        >{{ envCopyAnnouncement }}</span>
      </div>
    </details>
    <UAlert
      v-if="error"
      color="error"
      title="API keys are unavailable"
      :description="error.message"
    />
    <section
      v-else
      class="acme-card overflow-hidden"
    >
      <div class="border-b border-[#D9E5F7] px-5 py-4">
        <h2 class="font-semibold">
          Project keys
        </h2><p class="mt-1 text-xs text-[#62789C]">
          Names, scopes, and usage for this project
        </p>
      </div>
      <div class="hidden border-b border-[#E9F0FA] px-5 py-2 text-xs font-medium text-[#62789C] md:grid md:grid-cols-[1fr_1fr_1.5fr_1fr_auto] md:gap-3">
        <span>Name</span><span>Status</span><span>Scopes</span><span>Activity</span><span class="sr-only">Actions</span>
      </div>
      <div
        v-if="status === 'pending' && !keys"
        class="p-5"
      >
        <USkeleton class="h-48" />
      </div><div
        v-else-if="keys?.length"
        class="divide-y divide-[#E9F0FA]"
      >
        <div
          v-for="key in keys"
          :key="key.id"
          class="grid items-center gap-3 px-5 py-4 text-sm md:grid-cols-[1fr_1fr_1.5fr_1fr_auto]"
        >
          <div>
            <p class="font-medium">
              {{ key.name }}
            </p><p class="font-mono text-xs text-[#62789C]">
              {{ key.prefix }}…
            </p>
          </div><span>{{ key.revokedAt ? 'Revoked' : 'Active' }}</span><span class="break-words">{{ key.scopes.join(', ') }}</span><div class="text-xs text-[#62789C]">
            <p>Last used {{ formatDateTime(key.lastUsedAt) }}</p><p>Created {{ formatDateTime(key.createdAt) }}</p>
          </div><UButton
            v-if="!key.revokedAt && canManageKeys"
            label="Revoke"
            color="error"
            variant="ghost"
            @click="requestRevoke(key)"
          />
        </div>
      </div><div
        v-else
        class="px-5 py-14 text-center"
      >
        <p class="font-medium">
          No API keys
        </p><p class="mt-1 text-sm text-[#62789C]">
          Create a server credential when this project needs API access.
        </p>
      </div>
    </section>
    <UModal
      v-model:open="revokeOpen"
      title="Revoke API key?"
      description="Requests using this key will stop working."
      :dismissible="!revoking"
      :close="!revoking"
      :ui="{ content: 'max-w-md rounded-3xl', overlay: 'backdrop-blur-sm' }"
    >
      <template #body>
        <form
          class="space-y-5"
          @submit.prevent="revokeKey"
        >
          <p class="break-words text-sm text-[#62789C]">
            Revoke <strong class="text-[#10244A]">{{ revokeTarget?.name }}</strong>? This cannot be undone.
          </p>
          <UAlert
            v-if="revokeError"
            color="error"
            variant="subtle"
            title="Could not revoke API key"
            :description="revokeError"
          />
          <div class="flex justify-end gap-3">
            <UButton
              label="Cancel"
              color="neutral"
              variant="ghost"
              :disabled="revoking"
              @click="revokeOpen = false"
            />
            <UButton
              type="submit"
              label="Revoke key"
              color="error"
              :loading="revoking"
            />
          </div>
        </form>
      </template>
    </UModal>
  </div>
</template>
