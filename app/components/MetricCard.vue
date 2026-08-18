<script setup lang="ts">
defineProps<{ label: string, value: string, detail: string, icon: string, tone?: 'primary' | 'success' | 'warning' }>()
</script>

<template>
  <div class="acme-card p-5">
    <div class="flex items-start justify-between">
      <p class="text-sm font-medium text-[#62789C]">
        {{ label }}
      </p><div
        class="grid size-9 place-items-center rounded-lg"
        :class="tone === 'success' ? 'bg-emerald-50 text-emerald-700' : tone === 'warning' ? 'bg-amber-50 text-amber-700' : 'bg-[#DCEBFF] text-[#0A3DFF]'"
      >
        <UIcon :name="icon" />
      </div>
    </div>
    <p class="mt-4 text-2xl font-bold tracking-tight">
      {{ value }}
    </p><p class="mt-1 text-xs text-[#62789C]">
      {{ detail }}
    </p>
  </div>
</template>
