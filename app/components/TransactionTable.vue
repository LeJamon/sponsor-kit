<script setup lang="ts">
import { formatDateTime, shortenAddress } from '~/utils/format'

defineProps<{ items: Array<{ id: string, accountAddress: string, canonicalTransaction: Record<string, unknown>, state: string, createdAt: string | Date }> }>()
</script>

<template>
  <div class="overflow-x-auto">
    <table
      class="w-full whitespace-nowrap text-left text-sm"
      aria-label="Transactions"
    >
      <thead class="border-b border-[#E2E8F0] bg-[#FAFBFC] text-xs text-[#62789C]">
        <tr>
          <th class="px-5 py-3 font-medium">
            Transaction
          </th>
          <th class="px-5 py-3 font-medium">
            Type
          </th>
          <th class="px-5 py-3 font-medium">
            Wallet
          </th>
          <th class="px-5 py-3 font-medium">
            Status
          </th>
          <th class="px-5 py-3 text-right font-medium">
            Created
          </th>
        </tr>
      </thead>
      <tbody class="divide-y divide-[#E9F0FA]">
        <tr
          v-for="item in items"
          :key="item.id"
          class="hover:bg-[#FAFBFC]"
        >
          <td class="px-5 py-4">
            <NuxtLink
              :to="`/app/intents/${item.id}`"
              class="font-mono text-xs text-[#0A3DFF] hover:underline"
              :aria-label="`View transaction ${item.id}`"
            >
              {{ item.id.slice(0, 8) }}…
            </NuxtLink>
          </td>
          <td class="px-5 py-4">
            {{ item.canonicalTransaction.TransactionType }}
          </td>
          <td
            class="px-5 py-4 font-mono text-xs"
            :title="item.accountAddress"
          >
            {{ shortenAddress(item.accountAddress) }}
          </td>
          <td class="px-5 py-4">
            <IntentStatus :status="item.state" />
          </td>
          <td class="px-5 py-4 text-right text-xs text-[#62789C]">
            {{ formatDateTime(item.createdAt) }}
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
