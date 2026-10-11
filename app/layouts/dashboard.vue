<script setup lang="ts">
import { authClient } from '~~/lib/auth-client'

const route = useRoute()
const open = ref(false)
const signingOut = ref(false)
const collapsed = useCookie('acme-sidebar-collapsed', { default: () => false, sameSite: 'lax', maxAge: 60 * 60 * 24 * 365 })
const { data: context } = await useConsoleProject()
const { selectProject } = useProjectSelection()

const baseNavigation = [
  { label: 'Overview', icon: 'i-lucide-layout-dashboard', to: '/app' },
  { label: 'First sponsored payment', icon: 'i-lucide-send', to: '/app/first-payment' },
  { label: 'Intents', icon: 'i-lucide-list-checks', to: '/app/intents' },
  { label: 'Policies', icon: 'i-lucide-shield-check', to: '/app/policies' },
  { label: 'Reserve migration', icon: 'i-lucide-arrow-left-right', to: '/app/reserves/migrate' },
  { label: 'Funding', icon: 'i-lucide-landmark', to: '/app/funding' },
  { label: 'API keys', icon: 'i-lucide-key-round', to: '/app/api-keys' }
]
const navigation = computed(() => context.value?.user.platformAdmin ? [...baseNavigation, { label: 'Admin', icon: 'i-lucide-settings-2', to: '/admin' }] : baseNavigation)
const initials = computed(() => (context.value?.user.name || context.value?.user.email || 'User').split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase())

function isActive(to: string) {
  return to === '/app' ? route.path === to : route.path.startsWith(to)
}

async function signOut() {
  signingOut.value = true
  await authClient.signOut()
  selectProject(null)
  clearNuxtData('console-context')
  await navigateTo('/sign-in')
}
</script>

<template>
  <div class="min-h-screen bg-[#F7FAFF]">
    <aside
      v-if="!collapsed"
      id="desktop-navigation"
      class="fixed inset-y-0 left-0 z-40 hidden w-66 overflow-y-auto border-r border-[#D9E5F7] bg-white p-5 lg:block"
    >
      <div class="flex items-center justify-between gap-2">
        <NuxtLink to="/app"><AppLogo /></NuxtLink>
        <UButton
          icon="i-lucide-panel-left-close"
          aria-label="Collapse sidebar"
          aria-controls="desktop-navigation"
          :aria-expanded="true"
          color="neutral"
          variant="ghost"
          @click="collapsed = true"
        />
      </div>
      <nav
        aria-label="Console navigation"
        class="mt-7 space-y-1"
      >
        <NuxtLink
          v-for="item in navigation"
          :key="item.to"
          :to="item.to"
          class="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition"
          :class="isActive(item.to) ? 'bg-[#DCEBFF] text-[#0A3DFF]' : 'text-[#62789C] hover:bg-[#F7FAFF] hover:text-[#10244A]'"
        >
          <UIcon
            :name="item.icon"
            class="size-4.5"
          />{{ item.label }}
        </NuxtLink>
      </nav>
    </aside>

    <div :class="{ 'lg:pl-66': !collapsed }">
      <header class="sticky top-0 z-30 flex h-18 items-center justify-between border-b border-[#D9E5F7] bg-white/90 px-5 backdrop-blur lg:px-8">
        <div class="flex min-w-0 items-center gap-2 sm:gap-3">
          <UButton
            icon="i-lucide-menu"
            aria-label="Open navigation"
            color="neutral"
            variant="ghost"
            class="lg:hidden"
            @click="open = true"
          />
          <UButton
            v-if="collapsed"
            icon="i-lucide-panel-left-open"
            aria-label="Expand sidebar"
            aria-controls="desktop-navigation"
            :aria-expanded="false"
            color="neutral"
            variant="ghost"
            class="hidden lg:inline-flex"
            @click="collapsed = false"
          />
          <ProjectSwitcher />
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <UButton
            to="/docs"
            icon="i-lucide-book-open"
            label="Docs"
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
      </header>
      <main class="px-5 py-7 lg:px-8 lg:py-9">
        <slot />
      </main>
    </div>

    <USlideover
      v-model:open="open"
      side="left"
      title="Navigation"
    >
      <template #body>
        <nav class="space-y-1">
          <NuxtLink
            v-for="item in navigation"
            :key="item.to"
            :to="item.to"
            class="flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium"
            @click="open = false"
          ><UIcon :name="item.icon" />{{ item.label }}</NuxtLink>
        </nav>
      </template>
    </USlideover>
  </div>
</template>
