<script setup lang="ts">
defineProps<{ eyebrow?: string, title: string, description?: string }>()
</script>

<template>
  <div class="mb-7 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
    <div>
      <p
        v-if="eyebrow"
        class="acme-kicker"
      >
        {{ eyebrow }}
      </p><h1 class="text-2xl font-semibold tracking-tight sm:text-3xl">
        {{ title }}
      </h1><p
        v-if="description"
        class="mt-2 max-w-2xl text-sm leading-6 text-[#62789C]"
      >
        {{ description }}
      </p>
    </div>
    <div class="flex shrink-0 gap-2">
      <slot />
    </div>
  </div>
</template>
