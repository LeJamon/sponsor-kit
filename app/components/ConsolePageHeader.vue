<script setup lang="ts">
defineProps<{ eyebrow?: string, title: string, description: string }>()
</script>

<template>
  <div class="mb-8 flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
    <div>
      <p
        v-if="eyebrow"
        class="acme-kicker"
      >
        {{ eyebrow }}
      </p><h1 class="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">
        {{ title }}
      </h1><p class="mt-2 max-w-2xl text-sm leading-6 text-[#62789C]">
        {{ description }}
      </p>
    </div>
    <div class="flex shrink-0 gap-2">
      <slot />
    </div>
  </div>
</template>
