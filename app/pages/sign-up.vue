<script setup lang="ts">
import { authClient } from '~~/lib/auth-client'

const form = reactive({ name: '', organization: '', email: '', password: '' })
const loading = ref(false)
const error = ref('')
const accountCreated = ref(false)
const setupRecovery = ref(false)

async function finishSetup() {
  try {
    await $fetch('/api/onboarding', { method: 'POST', body: { organizationName: form.organization } })
    await navigateTo('/app')
  } catch (requestError: unknown) {
    // The account session already exists. Let the user retry setup without
    // submitting sign-up again or creating another authentication user.
    setupRecovery.value = true
    error.value = requestError instanceof Error ? requestError.message : 'Your account is ready, but project setup needs another try.'
  }
}

async function submit() {
  error.value = ''
  setupRecovery.value = false
  loading.value = true
  try {
    if (!accountCreated.value) {
      const result = await authClient.signUp.email({ name: form.name, email: form.email, password: form.password })
      if (result.error) {
        error.value = result.error.message || 'Unable to create the account.'
        return
      }
      accountCreated.value = true
    }
    await finishSetup()
  } catch {
    // A response timeout does not prove whether the auth provider committed the
    // user. Offer the existing recovery paths instead of submitting sign-up a
    // second time and risking a duplicate-user error.
    setupRecovery.value = true
    error.value = 'The sign-up request was interrupted. If your account was created, sign in and resume project setup without submitting sign-up again.'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <UContainer class="grid min-h-[calc(100vh-145px)] place-items-center py-16">
    <div class="acme-card w-full max-w-lg p-7 sm:p-9">
      <p class="acme-kicker">
        Start building
      </p><h1 class="mt-3 text-2xl font-bold">
        Create your organization
      </h1><p class="mt-2 text-sm text-[#62789C]">
        Set up a Devnet project in a few minutes.
      </p><UAlert
        v-if="error"
        :title="error"
        color="error"
        variant="subtle"
        class="mt-5"
      /><UAlert
        v-if="setupRecovery"
        class="mt-5"
        color="warning"
        variant="subtle"
        title="Setup can be resumed"
        description="If sign-up completed, sign in and open setup to finish setting up your workspace without creating another account."
      >
        <template #actions>
          <div class="flex flex-wrap gap-2">
            <UButton
              to="/app/setup"
              label="Resume project setup"
              color="warning"
              variant="soft"
            /><UButton
              to="/sign-in"
              label="Sign in"
              color="neutral"
              variant="ghost"
            />
          </div>
        </template>
      </UAlert><form
        class="mt-7 grid gap-5 sm:grid-cols-2"
        @submit.prevent="submit"
      >
        <UFormField label="Your name">
          <UInput
            v-model="form.name"
            autocomplete="name"
            required
            class="w-full"
          />
        </UFormField><UFormField label="Organization">
          <UInput
            v-model="form.organization"
            autocomplete="organization"
            required
            class="w-full"
          />
        </UFormField><UFormField
          label="Work email"
          class="sm:col-span-2"
        >
          <UInput
            v-model="form.email"
            type="email"
            autocomplete="email"
            required
            class="w-full"
          />
        </UFormField><UFormField
          label="Password"
          help="At least 12 characters"
          class="sm:col-span-2"
        >
          <UInput
            v-model="form.password"
            type="password"
            autocomplete="new-password"
            minlength="12"
            required
            class="w-full"
          />
        </UFormField><UButton
          type="submit"
          label="Create account"
          block
          size="lg"
          :loading="loading"
          class="sm:col-span-2"
        />
      </form><p class="mt-6 text-center text-sm text-[#62789C]">
        Already have an account? <NuxtLink
          to="/sign-in"
          class="font-semibold text-[#0A3DFF]"
        >Sign in</NuxtLink>
      </p>
    </div>
  </UContainer>
</template>
