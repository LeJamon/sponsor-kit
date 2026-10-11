<script setup lang="ts">
import { authClient } from '~~/lib/auth-client'

const route = useRoute()
const open = ref(false)
const signingOut = ref(false)
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
  <div class="dashboard-shell min-h-screen bg-[#F7FAFF]">
    <aside
      id="desktop-navigation"
      class="dashboard-sidebar fixed inset-y-0 left-0 z-40 hidden overflow-x-hidden overflow-y-auto border-r border-[#D9E5F7] bg-white px-3 py-5 lg:block"
    >
      <NuxtLink
        to="/app"
        aria-label="ACME overview"
        class="ml-2.5 inline-flex rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#0A3DFF]"
      >
        <AppLogo compact />
      </NuxtLink>
      <nav
        aria-label="Console navigation"
        class="mt-7 space-y-1"
      >
        <NuxtLink
          v-for="item in navigation"
          :key="item.to"
          :to="item.to"
          :aria-label="item.label"
          :aria-current="isActive(item.to) ? 'page' : undefined"
          class="dashboard-nav-link flex h-12 items-center rounded-xl px-4 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#0A3DFF]"
          :class="isActive(item.to) ? 'bg-[#DCEBFF] text-[#0A3DFF]' : 'text-[#62789C] hover:bg-[#F7FAFF] hover:text-[#10244A]'"
        >
          <UIcon
            :name="item.icon"
            class="size-5 shrink-0"
          />
          <span class="dashboard-nav-label">{{ item.label }}</span>
        </NuxtLink>
      </nav>
    </aside>

    <div class="dashboard-content">
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

<style scoped>
@media (min-width: 1024px) {
  .dashboard-shell {
    --sidebar-width: 5rem;
  }

  .dashboard-shell:has(.dashboard-sidebar:hover),
  .dashboard-shell:has(.dashboard-sidebar :focus-visible) {
    --sidebar-width: 16.5rem;
  }

  .dashboard-sidebar {
    width: var(--sidebar-width);
    transition: width 260ms ease;
  }

  .dashboard-content {
    padding-left: var(--sidebar-width);
    transition: padding-left 260ms ease;
  }

  .dashboard-nav-link {
    gap: 0;
    transition: gap 260ms ease, color 150ms ease, background-color 150ms ease;
  }

  .dashboard-nav-label {
    max-width: 0;
    overflow: hidden;
    white-space: nowrap;
    opacity: 0;
    transform: translateX(-0.375rem);
    transition: max-width 260ms ease, opacity 180ms ease, transform 260ms ease;
  }

  .dashboard-sidebar:is(:hover, :has(:focus-visible)) .dashboard-nav-link {
    gap: 0.75rem;
  }

  .dashboard-sidebar:is(:hover, :has(:focus-visible)) .dashboard-nav-label {
    max-width: 12rem;
    opacity: 1;
    transform: translateX(0);
  }
}

@media (min-width: 1024px) and (hover: none) {
  .dashboard-shell {
    --sidebar-width: 16.5rem;
  }

  .dashboard-nav-link {
    gap: 0.75rem;
  }

  .dashboard-nav-label {
    max-width: 12rem;
    opacity: 1;
    transform: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .dashboard-sidebar,
  .dashboard-content,
  .dashboard-nav-link,
  .dashboard-nav-label {
    transition: none;
  }
}
</style>
