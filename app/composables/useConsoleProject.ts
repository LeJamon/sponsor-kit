export async function useConsoleProject() {
  const { selectedId, selectProject } = useProjectSelection()
  const context = await useFetch('/api/console/context', { key: 'console-context' })
  const selected = computed(() => context.data.value?.projects.find(item => item.project.publicId === selectedId.value)
    || context.data.value?.projects[0])

  // Pages remount on project selection. Keep in-flight actions scoped to the
  // project they started in, even while the next page is loading.
  const projectId = ref(selected.value?.project.publicId)

  return { ...context, selected, projectId, selectProject }
}
