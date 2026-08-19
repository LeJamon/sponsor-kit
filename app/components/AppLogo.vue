<script setup lang="ts">
withDefaults(defineProps<{ compact?: boolean }>(), { compact: false })

const gradientId = useId()
</script>

<template>
  <span class="inline-flex items-center gap-2.5 font-bold tracking-tight text-[#10244A]">
    <svg
      viewBox="0 0 48 48"
      aria-hidden="true"
      class="h-9 w-9 shrink-0"
    >
      <defs>
        <linearGradient
          :id="gradientId"
          x1="8"
          y1="4"
          x2="38"
          y2="42"
          gradientUnits="userSpaceOnUse"
        >
          <stop stop-color="#0A3DFF" />
          <stop
            offset="1"
            stop-color="#5AA9FF"
          />
        </linearGradient>
      </defs>
      <path
        d="M25.7 4.5C16.4 14 11.6 24.6 9.2 37.7c7.6-2.4 14.2-7.1 18.4-13.6 3.2-4.9 4-10.3-1.9-19.6Z"
        :fill="`url(#${gradientId})`"
      />
      <path
        d="M30.5 16.2c-1 8.5-4.9 15.1-11.8 20.7 7.1.6 13.8 1.8 20.1 4.1-.3-9.3-2.9-17.7-8.3-24.8Z"
        fill="#0A3DFF"
        opacity=".92"
      />
      <path
        d="M7 41.5c8.9-1.5 19.6-1.3 34 1.6"
        fill="none"
        stroke="#10244A"
        stroke-linecap="round"
        stroke-width="2"
        opacity=".18"
      />
    </svg>
    <span
      v-if="!compact"
      class="text-xl"
    >ACME</span>
  </span>
</template>
