<script setup lang="ts">
definePageMeta({ layout: 'dashboard' })
const open = useState('project-creation-open', () => false)
onMounted(async () => {
  await navigateTo('/app', { replace: true })
  open.value = true
})
</script>

<template>
  <div
    class="sr-only"
    role="status"
  >
    Opening project creation…
  </div>
</template>
