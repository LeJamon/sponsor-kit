<script setup lang="ts">
import { authClient } from '~~/lib/auth-client'

const { data: session } = await authClient.useSession(useFetch)
const consoleLabel = computed(() => session.value?.user ? 'Open console' : 'Sign in')
const consoleRoute = computed(() => session.value?.user
  ? '/app'
  : { path: '/sign-in', query: { redirect: '/app' } })
</script>

<template>
  <div class="min-h-screen bg-[#F7FAFF]">
    <header class="sticky top-0 z-40 border-b border-[#D9E5F7]/80 bg-white/85 backdrop-blur-xl">
      <UContainer class="flex h-18 items-center justify-between">
        <NuxtLink
          to="/"
          aria-label="ACME home"
        ><AppLogo /></NuxtLink>
        <div class="flex items-center gap-2">
          <UButton
            to="/docs"
            label="Docs"
            color="neutral"
            variant="ghost"
          />
          <UButton
            :to="consoleRoute"
            :label="consoleLabel"
            class="min-w-29 justify-center"
            trailing-icon="i-lucide-arrow-up-right"
          />
        </div>
      </UContainer>
    </header>
    <main><slot /></main>
    <footer class="border-t border-[#D9E5F7] bg-white">
      <UContainer class="flex flex-col gap-6 py-10 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <AppLogo /><p class="mt-2 text-sm text-[#62789C]">
            Sponsor the journey on XRPL.
          </p>
        </div>
        <div class="flex gap-5 text-sm text-[#62789C]">
          <NuxtLink to="/docs">Docs</NuxtLink><NuxtLink to="/status">Status</NuxtLink><span>© {{ new Date().getFullYear() }}</span>
        </div>
      </UContainer>
    </footer>
  </div>
</template>
