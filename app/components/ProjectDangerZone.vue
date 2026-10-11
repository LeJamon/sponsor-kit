<script setup lang="ts">
const props = defineProps<{ project: { publicId: string, name: string } }>()
const { data: context, refresh, selectProject, error: contextError } = await useConsoleProject()
const toast = useToast()
const open = ref(false)
const confirmationName = ref('')
const deleting = ref(false)
const errorMessage = ref('')

function confirmDeletion() {
  confirmationName.value = ''
  errorMessage.value = ''
  open.value = true
}

async function deleteProject() {
  if (deleting.value || confirmationName.value !== props.project.name) return
  deleting.value = true
  errorMessage.value = ''
  const project = props.project
  try {
    await $fetch(`/api/console/projects/${project.publicId}`, { method: 'DELETE', body: { confirmationName: confirmationName.value } })
    await refresh()
    if (contextError.value) throw contextError.value
    clearNuxtData(key => key.includes(project.publicId))
    open.value = false
    selectProject(context.value?.projects[0]?.project.publicId || null)
    toast.add({ title: 'Project deleted', description: project.name, color: 'success', icon: 'i-lucide-circle-check' })
    await navigateTo('/app')
  } catch (error: unknown) {
    const failure = error as { data?: { statusMessage?: string } }
    errorMessage.value = failure.data?.statusMessage || 'Deletion could not be confirmed. Retry to check the same project.'
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <section class="mt-8 rounded-2xl border border-red-200 bg-white p-5 sm:p-6">
    <h2 class="font-semibold text-red-700">
      Danger zone
    </h2>
    <div class="mt-4 flex flex-wrap items-center justify-between gap-4">
      <div class="max-w-xl">
        <h3 class="text-sm font-semibold">
          Delete this project
        </h3>
        <p class="mt-1 text-sm leading-6 text-[#62789C]">
          Remove this project from your workspace and revoke its API keys. This cannot be undone.
        </p>
      </div>
      <UButton
        label="Delete project"
        color="error"
        variant="soft"
        icon="i-lucide-trash-2"
        @click="confirmDeletion"
      />
    </div>
    <UModal
      v-model:open="open"
      title="Delete project?"
      description="The project will be removed and its API keys revoked. Transaction records are retained. Pending transactions and active reserve sponsorships must be resolved first."
      :dismissible="!deleting"
      :close="!deleting"
      :ui="{ content: 'max-w-md rounded-3xl', overlay: 'backdrop-blur-sm' }"
    >
      <template #body>
        <form
          class="space-y-5"
          @submit.prevent="deleteProject"
        >
          <p class="break-words text-sm text-[#62789C]">
            Type <strong class="text-[#10244A]">{{ project.name }}</strong> to confirm.
          </p>
          <UFormField
            label="Project name confirmation"
            name="confirmationName"
          >
            <UInput
              v-model="confirmationName"
              class="w-full"
              size="lg"
              autocomplete="off"
              :disabled="deleting"
              required
            />
          </UFormField>
          <UAlert
            v-if="errorMessage"
            color="error"
            title="Project could not be deleted"
            :description="errorMessage"
          />
          <div class="flex justify-end gap-3">
            <UButton
              label="Cancel"
              color="neutral"
              variant="ghost"
              :disabled="deleting"
              @click="open = false"
            />
            <UButton
              type="submit"
              label="Delete project"
              color="error"
              :loading="deleting"
              :disabled="confirmationName !== project.name"
            />
          </div>
        </form>
      </template>
    </UModal>
  </section>
</template>
