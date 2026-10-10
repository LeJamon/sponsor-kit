<script setup lang="ts">
import { authClient } from '~~/lib/auth-client'

const email = ref('')
const password = ref('')
const loading = ref(false)
const error = ref('')
const route = useRoute()

function redirectTarget() {
  const target = typeof route.query.redirect === 'string' ? route.query.redirect : '/app'
  return target.startsWith('/') && !target.startsWith('//') ? target : '/app'
}

async function submit() {
  error.value = ''
  loading.value = true
  try {
    const result = await authClient.signIn.email({ email: email.value, password: password.value })
    if (result.error) {
      error.value = 'Unable to sign in with those credentials.'
      return
    }
    await navigateTo(redirectTarget())
  } catch {
    error.value = 'The authentication service is unavailable.'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <UContainer class="grid min-h-[calc(100vh-145px)] place-items-center py-16">
    <div class="acme-card w-full max-w-md p-7 sm:p-9">
      <p class="acme-kicker">
        Developer console
      </p><h1 class="mt-3 text-2xl font-bold">
        Welcome back
      </h1><p class="mt-2 text-sm text-[#62789C]">
        Sign in to manage sponsorship projects.
      </p><UAlert
        v-if="error"
        :title="error"
        color="error"
        variant="subtle"
        class="mt-5"
      /><form
        class="mt-7 space-y-5"
        @submit.prevent="submit"
      >
        <UFormField label="Email">
          <UInput
            v-model="email"
            type="email"
            autocomplete="email"
            required
            class="w-full"
            size="lg"
          />
        </UFormField><UFormField label="Password">
          <UInput
            v-model="password"
            type="password"
            autocomplete="current-password"
            required
            class="w-full"
            size="lg"
          /><template #hint>
            <NuxtLink
              to="/forgot-password"
              class="font-semibold text-[#0A3DFF]"
            >Forgot password?</NuxtLink>
          </template>
        </UFormField><UButton
          type="submit"
          label="Sign in"
          block
          size="lg"
          :loading="loading"
        />
      </form><p class="mt-6 text-center text-sm text-[#62789C]">
        New to ACME? <NuxtLink
          to="/sign-up"
          class="font-semibold text-[#0A3DFF]"
        >Create an account</NuxtLink>
      </p>
    </div>
  </UContainer>
</template>
