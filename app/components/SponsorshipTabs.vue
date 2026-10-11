<script setup lang="ts">
const route = useRoute()

const tabs = [
  { label: 'Policies', to: '/app/sponsorship' },
  { label: 'Usage', to: '/app/sponsorship/usage' }
]

const activePath = computed(() => route.path.startsWith('/app/sponsorship/usage') ? '/app/sponsorship/usage' : '/app/sponsorship')
</script>

<template>
  <nav
    aria-label="Sponsorship"
    class="mb-6 flex gap-1 overflow-x-auto border-b border-[#D9E5F7]"
  >
    <NuxtLink
      v-for="tab in tabs"
      :key="tab.to"
      :to="tab.to"
      class="shrink-0 border-b-2 px-3 py-2.5 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3DFF]"
      :class="activePath === tab.to ? 'border-[#0A3DFF] text-[#0A3DFF]' : 'border-transparent text-[#62789C] hover:border-[#8BC3FF] hover:text-[#10244A]'"
      :aria-current="activePath === tab.to ? 'page' : undefined"
    >
      {{ tab.label }}
    </NuxtLink>
  </nav>
</template>
