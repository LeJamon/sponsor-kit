<script setup lang="ts">
definePageMeta({ layout: 'dashboard' })

type ReadinessCheck = { key: string, label: string, ok: boolean, detail: string }
type Readiness = { ready: boolean, checks: ReadinessCheck[] }

const { selected: project, error: contextError, refresh: refreshContext } = await useConsoleProject()
const { data: readiness, status: readinessStatus, error: readinessError, refresh: refreshReadiness } = await useFetch<Readiness>('/api/console/readiness')
const createOpen = useState('project-creation-open', () => false)
const hasProject = computed(() => Boolean(project.value))

async function retryChecks() {
  await Promise.all([refreshContext(), refreshReadiness()])
}
</script>

<template>
  <div class="mx-auto max-w-5xl">
    <ConsolePageHeader
      :title="hasProject ? 'Network checks' : 'Create your first project'"
    >
      <UButton
        v-if="hasProject"
        to="/app"
        label="Open console"
        trailing-icon="i-lucide-arrow-right"
      />
    </ConsolePageHeader>

    <UAlert
      v-if="contextError"
      class="mb-6"
      color="error"
      title="Your session could not be loaded"
      :description="contextError.message"
    >
      <template #actions>
        <UButton
          label="Retry"
          color="error"
          variant="soft"
          @click="retryChecks"
        />
      </template>
    </UAlert>

    <section
      v-if="!hasProject"
      class="acme-card p-6 sm:p-8"
    >
      <div class="flex items-start gap-4">
        <span class="grid size-11 shrink-0 place-items-center rounded-xl bg-[#DCEBFF] text-[#0A3DFF]">
          <UIcon
            name="i-lucide-panels-top-left"
            class="size-5"
          />
        </span>
        <div>
          <h2 class="font-semibold">
            No projects
          </h2>
          <p class="mt-1 max-w-2xl text-sm leading-6 text-[#62789C]">
            Choose a project name and network to get started.
          </p>
        </div>
      </div>
      <UButton
        class="mt-6"
        label="Create project"
        trailing-icon="i-lucide-plus"
        @click="createOpen = true"
      />
    </section>

    <template v-else>
      <section class="acme-card p-6 sm:p-8">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p class="text-xs font-semibold uppercase tracking-[0.14em] text-[#62789C]">
              Project
            </p>
            <h2 class="mt-2 text-xl font-semibold">
              {{ project?.project.name }}
            </h2>
            <p class="mt-1 break-all font-mono text-xs text-[#62789C]">
              {{ project?.project.publicId }}
            </p>
          </div>
          <div class="flex gap-2">
            <UBadge
              label="Devnet"
              color="primary"
              variant="subtle"
            />
          </div>
        </div>
      </section>
    </template>

    <section class="acme-card mt-6 overflow-hidden">
      <div class="flex flex-wrap items-center justify-between gap-3 border-b border-[#D9E5F7] px-5 py-4">
        <div>
          <h2 class="font-semibold">
            Network readiness
          </h2>
        </div>
        <UButton
          label="Refresh checks"
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="ghost"
          :loading="readinessStatus === 'pending'"
          @click="() => refreshReadiness()"
        />
      </div>
      <div
        v-if="readinessError"
        class="p-5"
      >
        <UAlert
          color="error"
          title="Readiness is unavailable"
          :description="readinessError.message"
        />
      </div>
      <div
        v-else-if="readinessStatus === 'pending' && !readiness"
        class="space-y-3 p-5"
      >
        <USkeleton
          v-for="index in 3"
          :key="index"
          class="h-14 rounded-xl"
        />
      </div>
      <div
        v-else-if="readiness?.checks?.length"
        class="divide-y divide-[#E9F0FA]"
      >
        <div
          v-for="check in readiness.checks"
          :key="check.key"
          class="flex items-start gap-3 px-5 py-4"
        >
          <UIcon
            :name="check.ok ? 'i-lucide-circle-check' : 'i-lucide-circle-alert'"
            class="mt-0.5 size-5 shrink-0"
            :class="check.ok ? 'text-emerald-600' : 'text-amber-600'"
          />
          <div class="min-w-0">
            <p class="text-sm font-medium">
              {{ check.label }}
            </p>
            <p class="mt-1 text-xs leading-5 text-[#62789C]">
              {{ check.detail }}
            </p>
          </div>
          <UBadge
            class="ml-auto shrink-0"
            :label="check.ok ? 'Ready' : 'Needs attention'"
            :color="check.ok ? 'success' : 'warning'"
            variant="subtle"
          />
        </div>
      </div>
      <div
        v-else
        class="p-5 text-sm text-[#62789C]"
      >
        No readiness checks were returned. Refresh before starting a transaction.
      </div>
    </section>
  </div>
</template>
