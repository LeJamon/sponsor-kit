<script setup lang="ts">
const props = defineProps<{ status: string }>()
const config = computed(() => ({
  created: { color: 'neutral' as const, icon: 'i-lucide-circle-dashed' },
  validated: { color: 'success' as const, icon: 'i-lucide-circle-check' },
  submitted: { color: 'info' as const, icon: 'i-lucide-radio' },
  awaiting_user_signature: { color: 'warning' as const, icon: 'i-lucide-pen-line' },
  user_signature_received: { color: 'info' as const, icon: 'i-lucide-signature' },
  verified: { color: 'info' as const, icon: 'i-lucide-shield-check' },
  awaiting_sponsor_signature: { color: 'warning' as const, icon: 'i-lucide-key-round' },
  submitting: { color: 'info' as const, icon: 'i-lucide-loader-circle' },
  failed: { color: 'error' as const, icon: 'i-lucide-triangle-alert' },
  rejected: { color: 'error' as const, icon: 'i-lucide-circle-x' },
  expired: { color: 'neutral' as const, icon: 'i-lucide-clock' },
  cancelled: { color: 'neutral' as const, icon: 'i-lucide-ban' },
  superseded: { color: 'neutral' as const, icon: 'i-lucide-history' }
}[props.status] || { color: 'neutral' as const, icon: 'i-lucide-circle-dashed' }))
const label = computed(() => props.status.replaceAll('_', ' '))
</script>

<template>
  <UBadge
    :label="label"
    :color="config.color"
    :icon="config.icon"
    variant="subtle"
    class="capitalize"
  />
</template>
