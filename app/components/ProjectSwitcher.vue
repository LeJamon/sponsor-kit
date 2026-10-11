<script setup lang="ts">
const { data: context, selected, selectProject } = await useConsoleProject()
const createOpen = useState('project-creation-open', () => false)
const canCreate = computed(() => Boolean(context.value && (selected.value ? ['owner', 'admin'].includes(selected.value.role) : !context.value.organizations.length || context.value.organizations.some(item => ['owner', 'admin'].includes(item.role)))))
const items = computed(() => [
  (context.value?.projects || []).map(item => ({
    label: item.project.name,
    description: item.organization.name,
    icon: item.project.publicId === selected.value?.project.publicId ? 'i-lucide-check' : 'i-lucide-folder',
    onSelect: async () => {
      if (item.project.publicId === selected.value?.project.publicId) return
      selectProject(item.project.publicId)
      await navigateTo('/app')
    }
  })),
  ...(canCreate.value ? [[{ label: 'Create project', icon: 'i-lucide-plus', onSelect: () => { createOpen.value = true } }]] : [])
])
</script>

<template>
  <UDropdownMenu
    :items="items"
    :content="{ align: 'start' }"
    :ui="{ content: 'w-72 max-w-[calc(100vw-2rem)]', viewport: 'max-h-96 overflow-y-auto' }"
  >
    <UButton
      color="neutral"
      variant="ghost"
      icon="i-lucide-box"
      trailing-icon="i-lucide-chevrons-up-down"
      aria-label="Choose project"
      class="min-w-0 max-w-48 sm:max-w-80"
      :ui="{ trailingIcon: 'shrink-0' }"
    >
      <span class="min-w-0 text-left">
        <span class="block truncate text-sm font-semibold text-[#10244A]">{{ selected?.project.name || 'Create your first project' }}</span>
      </span>
    </UButton>
  </UDropdownMenu>
</template>
