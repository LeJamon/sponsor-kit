<script setup lang="ts">
const open = useState('project-creation-open', () => false)
const toast = useToast()
const { data: context, selected, refresh, selectProject, error: contextError } = await useConsoleProject()
const name = ref('')
const network = ref('devnet')
const saving = ref(false)
const errorMessage = ref('')
const organizationId = ref<string>()
const attempt = ref<{ organizationId?: string, organizationName: string, name: string, network: 'devnet', requestId: string } | null>(null)
const canCreate = computed(() => Boolean(context.value && (!context.value.organizations.length || context.value.organizations.some(item => item.organization.id === organizationId.value && ['owner', 'admin'].includes(item.role)))))

watch(open, (isOpen) => {
  if (!isOpen || attempt.value) return
  name.value = ''
  errorMessage.value = ''
  organizationId.value = selected.value?.organization.id || context.value?.organizations.find(item => ['owner', 'admin'].includes(item.role))?.organization.id
})

async function createProject() {
  if (saving.value || !canCreate.value || name.value.trim().length < 2 || name.value.trim().length > 80) return
  saving.value = true
  errorMessage.value = ''
  try {
    attempt.value ||= {
      organizationId: organizationId.value,
      organizationName: `${context.value?.user.name || 'My'}'s workspace`.slice(0, 80),
      name: name.value.trim(),
      network: 'devnet',
      requestId: crypto.randomUUID()
    }
    const request = attempt.value
    const result = request.organizationId
      ? await $fetch('/api/console/projects', { method: 'POST', body: { organizationId: request.organizationId, name: request.name, network: request.network, requestId: request.requestId } })
      : await $fetch('/api/onboarding', { method: 'POST', body: { organizationName: request.organizationName, projectName: request.name, network: request.network } })
    await refresh()
    if (contextError.value) throw contextError.value
    open.value = false
    attempt.value = null
    selectProject(result.project.publicId)
    toast.add({ title: 'Project created', description: result.project.name, color: 'success', icon: 'i-lucide-circle-check' })
    await navigateTo('/app')
  } catch (error: unknown) {
    const failure = error as { statusCode?: number, data?: { statusMessage?: string } }
    if (failure.statusCode && failure.statusCode >= 400 && failure.statusCode < 500) attempt.value = null
    errorMessage.value = failure.data?.statusMessage || 'The project could not be confirmed. Retry to finish the same request.'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    title="Create a project"
    description="Choose a name and network for your project."
    :dismissible="!saving"
    :close="!saving"
    :ui="{ content: 'max-w-md rounded-3xl', header: 'border-0 pt-8 px-8', title: 'text-2xl font-semibold', description: 'sr-only', body: 'px-8 pt-3 pb-8', overlay: 'backdrop-blur-sm' }"
  >
    <template #body>
      <form
        class="space-y-5"
        @submit.prevent="createProject"
      >
        <UFormField
          label="Name"
          name="projectName"
        >
          <UInput
            v-model="name"
            class="w-full"
            size="xl"
            placeholder="My application"
            autocomplete="off"
            minlength="2"
            maxlength="80"
            :disabled="saving || !!attempt"
            autofocus
            required
          />
        </UFormField>
        <UFormField
          label="Network"
          name="network"
        >
          <USelect
            v-model="network"
            :items="[{ label: 'XRPL Devnet', value: 'devnet' }]"
            :disabled="saving || !!attempt"
            class="w-full"
            size="xl"
          />
        </UFormField>
        <UAlert
          v-if="errorMessage || !canCreate"
          color="error"
          title="Project creation needs attention"
          :description="errorMessage || 'An organization owner or admin can create projects.'"
        />
        <UButton
          type="submit"
          :label="attempt && !saving ? 'Retry creation' : 'Create'"
          :loading="saving"
          :disabled="!canCreate || name.trim().length < 2 || name.trim().length > 80"
          block
          size="xl"
        />
      </form>
    </template>
  </UModal>
</template>
