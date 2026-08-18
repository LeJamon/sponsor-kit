<script setup lang="ts">
import { formatDateTime } from '~/utils/format'

definePageMeta({ layout: 'dashboard' })
type ApiKeyScope = 'intents:create' | 'intents:read' | 'usage:read'
const scopeItems: Array<{ label: string, value: ApiKeyScope }> = [
  { label: 'Create intents', value: 'intents:create' },
  { label: 'Read intents', value: 'intents:read' },
  { label: 'Read usage', value: 'usage:read' }
]
const { data: context } = await useFetch('/api/console/context')
const projectId = computed(() => context.value?.projects?.[0]?.project.publicId)
const { data: keys, status, error, refresh } = await useAsyncData('project-api-keys', () => projectId.value ? $fetch(`/api/console/projects/${projectId.value}/api-keys`) : Promise.resolve([]), { watch: [projectId] })
const open = ref(false)
const name = ref('')
const scopes = ref<ApiKeyScope[]>(['intents:create', 'intents:read'])
const createdSecret = ref('')
const copyState = ref<'idle' | 'copied' | 'failed'>('idle')
const mutationError = ref('')
const saving = ref(false)
let copyResetTimer: ReturnType<typeof setTimeout> | undefined

const copyLabel = computed(() => copyState.value === 'copied' ? 'Copied' : copyState.value === 'failed' ? 'Copy failed' : 'Copy')
const copyIcon = computed(() => copyState.value === 'copied' ? 'i-lucide-check' : copyState.value === 'failed' ? 'i-lucide-triangle-alert' : 'i-lucide-copy')
const copyAnnouncement = computed(() => copyState.value === 'copied' ? 'API key secret copied to clipboard.' : copyState.value === 'failed' ? 'Could not copy the API key secret. Select it and copy it manually.' : '')

async function createKey() {
  if (!projectId.value) return
  saving.value = true
  mutationError.value = ''
  try {
    const result = await $fetch(`/api/console/projects/${projectId.value}/api-keys`, { method: 'POST', body: { name: name.value, scopes: scopes.value } })
    createdSecret.value = result.secret
    copyState.value = 'idle'
    name.value = ''
    await refresh()
  } catch (requestError: unknown) {
    mutationError.value = requestError instanceof Error ? requestError.message : 'API key creation failed.'
  } finally { saving.value = false }
}

async function revokeKey(keyId: string) {
  if (!projectId.value) return
  await $fetch(`/api/console/projects/${projectId.value}/api-keys/${keyId}`, { method: 'DELETE' })
  await refresh()
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
})
</script>

<template>
  <div>
    <ConsolePageHeader
      eyebrow="Developer access"
      title="API keys"
      description="Backend credentials are hashed at rest. A new secret is shown exactly when it is created."
    >
      <UButton
        label="Create API key"
        icon="i-lucide-plus"
        @click="open = !open"
      />
    </ConsolePageHeader>
    <section
      v-if="open"
      class="acme-card mb-6 p-5"
    >
      <h2 class="font-semibold">
        New API key
      </h2><div class="mt-4 grid gap-4">
        <UFormField label="Name">
          <UInput
            v-model="name"
            class="w-full"
            placeholder="Backend integration"
          />
        </UFormField><UFormField label="Scopes">
          <UCheckboxGroup
            v-model="scopes"
            :items="scopeItems"
            orientation="horizontal"
            :ui="{ fieldset: 'flex-wrap gap-x-4' }"
          />
        </UFormField><UAlert
          v-if="mutationError"
          color="error"
          :description="mutationError"
        /><div>
          <UButton
            label="Create key"
            :loading="saving"
            :disabled="name.trim().length < 2 || !scopes.length"
            @click="createKey"
          />
        </div>
      </div>
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
          </div><span>{{ key.revokedAt ? 'Revoked' : 'Active' }}</span><span>{{ key.scopes.join(', ') }}</span><div class="text-xs text-[#62789C]">
            <p>Last used {{ formatDateTime(key.lastUsedAt) }}</p><p>Created {{ formatDateTime(key.createdAt) }}</p>
          </div><UButton
            v-if="!key.revokedAt"
            label="Revoke"
            color="error"
            variant="ghost"
            @click="revokeKey(key.id)"
          />
        </div>
      </div><div
        v-else
        class="px-5 py-14 text-center"
      >
        <p class="font-medium">
          No API keys
        </p><p class="mt-1 text-sm text-[#62789C]">
          Create a credential for your backend integration.
        </p>
      </div>
    </section>
  </div>
</template>
