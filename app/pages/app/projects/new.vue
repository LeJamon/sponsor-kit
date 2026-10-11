<script setup lang="ts">
definePageMeta({ layout: 'dashboard' })

const { data: context, selected, refresh, selectProject } = await useConsoleProject()
const organizations = computed(() => [...new Map((context.value?.projects || [])
  .filter(item => ['owner', 'admin'].includes(item.role))
  .map(item => [item.organization.id, { label: item.organization.name, value: item.organization.id }])).values()])
const organizationId = ref(organizations.value.find(item => item.value === selected.value?.organization.id)?.value || organizations.value[0]?.value)
const name = ref('')
const saving = ref(false)
const errorMessage = ref('')
const attempt = ref<{ organizationId: string, name: string, requestId: string } | null>(null)

async function createProject() {
  if (saving.value || !organizationId.value || name.value.trim().length < 2) return
  saving.value = true
  errorMessage.value = ''
  try {
    attempt.value ||= { organizationId: organizationId.value, name: name.value.trim(), requestId: crypto.randomUUID() }
    const result = await $fetch('/api/console/projects', { method: 'POST', body: attempt.value })
    await refresh()
    selectProject(result.project.publicId)
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
  <div class="mx-auto max-w-3xl">
    <ConsolePageHeader
      eyebrow="Projects"
      title="Create project"
      description="Give your application its own sponsorship policies, API keys, and budget."
    />
    <form
      v-if="organizations.length"
      class="acme-card space-y-6 p-6 sm:p-8"
      @submit.prevent="createProject"
    >
      <UFormField
        label="Project name"
        name="projectName"
        help="Choose a name your team will recognize."
      >
        <UInput
          v-model="name"
          class="w-full"
          size="lg"
          placeholder="My application"
          autocomplete="off"
          minlength="2"
          maxlength="80"
          :disabled="saving || !!attempt"
          required
        />
      </UFormField>
      <UFormField
        label="Organization"
        name="organization"
      >
        <USelect
          v-model="organizationId"
          :items="organizations"
          :disabled="saving || !!attempt || organizations.length === 1"
          class="w-full"
          size="lg"
        />
      </UFormField>
      <p class="text-sm text-[#62789C]">
        Network: XRPL Devnet
      </p>
      <UAlert
        v-if="errorMessage"
        color="error"
        title="Project creation needs attention"
        :description="errorMessage"
      />
      <div class="flex items-center gap-3">
        <UButton
          type="submit"
          :label="attempt ? 'Retry creation' : 'Create project'"
          :loading="saving"
          :disabled="!organizationId || name.trim().length < 2 || name.trim().length > 80"
        />
        <UButton
          to="/app"
          label="Cancel"
          color="neutral"
          variant="ghost"
          :disabled="saving"
        />
      </div>
    </form>
    <UAlert
      v-else
      color="neutral"
      title="An organization owner or admin can create projects"
      description="Ask your organization administrator to create a project for your team."
    />
  </div>
</template>
