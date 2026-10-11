<script setup lang="ts">
import { authClient } from '~~/lib/auth-client'
import { safeAuthRedirect } from '~~/lib/auth-redirect'

definePageMeta({ layout: 'auth' })

const email = ref('')
const password = ref('')
const loading = ref(false)
const error = ref('')
const showPassword = ref(false)
const route = useRoute()

function redirectTarget() {
  return safeAuthRedirect(route.query.redirect)
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
  <div class="mx-auto flex w-full max-w-[28rem] flex-col">
    <NuxtLink
      to="/"
      aria-label="ACME home"
      class="w-fit rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#0A3DFF]"
    >
      <AppLogo />
    </NuxtLink>

    <div class="mt-10 sm:mt-12">
      <p class="acme-kicker">
        Developer console
      </p>
      <h1 class="mt-3 text-3xl font-semibold tracking-tight text-[#10244A] sm:text-4xl">
        Welcome back
      </h1>
      <p class="mt-3 text-sm leading-6 text-[#62789C] sm:text-base">
        Sign in to manage sponsorship projects.
      </p>
    </div>

    <UAlert
      v-if="error"
      :title="error"
      color="error"
      variant="subtle"
      role="alert"
      aria-live="assertive"
      class="mt-6"
    />

    <form
      class="mt-8 space-y-5"
      @submit.prevent="submit"
    >
      <div class="space-y-2">
        <label
          for="email"
          class="block text-sm font-semibold text-[#10244A]"
        >Email</label>
        <UInput
          id="email"
          v-model="email"
          name="email"
          type="email"
          autocomplete="email"
          inputmode="email"
          required
          class="w-full"
          size="lg"
        />
      </div>

      <div class="space-y-2">
        <div class="flex items-center justify-between gap-4">
          <label
            for="password"
            class="block text-sm font-semibold text-[#10244A]"
          >Password</label>
          <NuxtLink
            to="/forgot-password"
            class="text-sm font-semibold text-[#0A3DFF] underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#0A3DFF]"
          >Forgot password?</NuxtLink>
        </div>
        <UInput
          id="password"
          v-model="password"
          name="password"
          :type="showPassword ? 'text' : 'password'"
          autocomplete="current-password"
          required
          class="w-full"
          size="lg"
        >
          <template #trailing>
            <UButton
              type="button"
              :icon="showPassword ? 'i-lucide-eye-off' : 'i-lucide-eye'"
              :aria-label="showPassword ? 'Hide password' : 'Show password'"
              aria-controls="password"
              :aria-pressed="showPassword"
              color="neutral"
              variant="ghost"
              size="xs"
              square
              @click="showPassword = !showPassword"
            />
          </template>
        </UInput>
      </div>

      <UButton
        type="submit"
        label="Sign in"
        block
        size="lg"
        :loading="loading"
        class="mt-1"
      />
    </form>

    <div class="min-h-48">
      <AuthProviderButtons :callback-url="redirectTarget()" />
    </div>

    <p class="mt-6 text-center text-sm text-[#62789C]">
      New to ACME?
      <NuxtLink
        to="/sign-up"
        class="font-semibold text-[#0A3DFF] underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#0A3DFF]"
      >Create an account</NuxtLink>
    </p>
  </div>
</template>
