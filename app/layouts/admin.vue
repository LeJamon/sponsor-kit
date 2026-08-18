<script setup lang="ts">
import { authClient } from '~~/lib/auth-client'

const { data: session } = await authClient.useSession(useFetch)
const signingOut = ref(false)

const initials = computed(() => {
  const name = session.value?.user.name || session.value?.user.email || 'Admin'
  return name.split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase()
})

async function signOut() {
  signingOut.value = true
  await authClient.signOut()
  await navigateTo('/sign-in')
}
</script>

<template>
  <div class="min-h-screen bg-[#F7FAFF]">
    <header class="sticky top-0 z-30 border-b border-[#D9E5F7] bg-white/95 backdrop-blur">
      <div class="mx-auto flex h-18 max-w-[1500px] items-center justify-between px-5 lg:px-8">
        <div class="flex items-center gap-5">
          <NuxtLink to="/admin"><AppLogo /></NuxtLink>
          <span class="hidden h-7 w-px bg-[#D9E5F7] sm:block" />
          <div class="hidden sm:block">
            <p class="text-xs font-medium text-[#62789C]">
              PLATFORM
            </p><p class="text-sm font-semibold">
              Operations control plane
            </p>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <UButton
            to="/app"
            label="Developer console"
            icon="i-lucide-layout-dashboard"
            color="neutral"
            variant="ghost"
            class="hidden sm:flex"
          />
          <UAvatar
            :text="initials"
            size="sm"
            class="bg-[#DCEBFF] text-[#0A3DFF]"
          />
          <UButton
            icon="i-lucide-log-out"
            aria-label="Sign out"
            color="neutral"
            variant="ghost"
            :loading="signingOut"
            @click="signOut"
          />
        </div>
      </div>
    </header>
    <main class="mx-auto max-w-[1500px] px-5 py-7 lg:px-8 lg:py-9">
      <slot />
    </main>
  </div>
</template>
