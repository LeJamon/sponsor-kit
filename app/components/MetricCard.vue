<script setup lang="ts">
defineProps<{ label: string, value: string, detail?: string, icon?: string, tone?: 'primary' | 'success' | 'warning' }>()
</script>

<template>
  <div class="acme-card flex min-w-0 flex-col justify-between gap-7 p-5 sm:p-6">
    <p class="break-words text-3xl font-semibold tracking-tight tabular-nums">
      {{ value }}
    </p>
    <div class="space-y-1">
      <p class="text-sm font-medium">
        {{ label }}
      </p>
      <p
        v-if="detail"
        class="text-xs text-[#62789C]"
      >
        {{ detail }}
      </p>
    </div>
  </div>
</template>
