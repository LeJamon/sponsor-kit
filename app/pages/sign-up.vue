<script setup lang="ts">
import { authClient } from '~~/lib/auth-client'

const form = reactive({ name: '', organization: '', email: '', password: '', terms: false })
const loading = ref(false)
const error = ref('')

async function submit() {
  if (!form.terms) return
  error.value = ''
  loading.value = true
  const result = await authClient.signUp.email({ name: form.name, email: form.email, password: form.password })
  loading.value = false
  if (result.error) {
    error.value = result.error.message || 'Unable to create the account.'
    return
  }
  await $fetch('/api/onboarding', { method: 'POST', body: { organizationName: form.organization } })
  await navigateTo('/app')
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
      /><form
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
        </UFormField><UCheckbox
          v-model="form.terms"
          required
          label="I agree to the terms and privacy policy"
          class="sm:col-span-2"
        /><UButton
          type="submit"
          label="Create account"
          block
          size="lg"
          :loading="loading"
          :disabled="!form.terms"
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
