<script setup lang="ts">
import { authClient } from '~~/lib/auth-client'
import { safeAuthRedirect } from '~~/lib/auth-redirect'

const props = defineProps<{ callbackUrl?: string }>()
const route = useRoute()
const { data: config, error: configError, status, refresh } = await useFetch('/api/auth/config')
const pendingProvider = ref<string | null>(null)
const requestError = ref('')
const callbackError = computed(() => {
  if (!route.query.error) return ''
  return route.query.error === 'access_denied'
    ? 'Sign-in was cancelled. You can try again or use your email and password.'
    : 'We could not complete that sign-in. Try again, or use your existing sign-in method if you already have an account.'
})
const providers = computed(() => [
  ...(config.value?.socialProviders ?? []).map(provider => ({
    id: provider,
    label: provider === 'google' ? 'Continue with Google' : 'Continue with GitHub'
  })),
  ...(config.value?.sso ? [{ id: config.value.sso.providerId, label: config.value.sso.label }] : [])
])

async function signIn(provider: string) {
  if (pendingProvider.value) return
  requestError.value = ''
  pendingProvider.value = provider
  const callbackURL = safeAuthRedirect(props.callbackUrl)
  try {
    const result = await authClient.signIn.social({
      provider,
      callbackURL,
      newUserCallbackURL: '/app/setup',
      errorCallbackURL: `/sign-in?redirect=${encodeURIComponent(callbackURL)}`
    })
    if (result.error) requestError.value = 'This sign-in method is unavailable right now. Try again or sign in with your email and password.'
  } catch {
    requestError.value = 'Unable to reach the sign-in service. Please try again.'
  } finally {
    pendingProvider.value = null
  }
}
</script>

<template>
  <div
    v-if="providers.length || configError || callbackError || requestError"
    class="mt-7"
  >
    <UAlert
      v-if="callbackError || requestError"
      :title="requestError || callbackError"
      color="error"
      variant="subtle"
      class="mb-5"
      role="alert"
    />
    <div
      v-if="providers.length"
      class="space-y-3"
    >
      <div class="mb-5 flex items-center gap-4 text-xs text-[#62789C]">
        <span class="h-px flex-1 bg-[#D9E5F7]" />
        <span>or continue with</span>
        <span class="h-px flex-1 bg-[#D9E5F7]" />
      </div>
      <UButton
        v-for="provider in providers"
        :key="provider.id"
        :label="provider.label"
        :loading="pendingProvider === provider.id"
        :disabled="pendingProvider !== null"
        color="neutral"
        variant="outline"
        size="lg"
        block
        class="min-h-11 rounded-lg bg-white"
        @click="signIn(provider.id)"
      >
        <template #leading>
          <UIcon
            v-if="pendingProvider === provider.id"
            name="i-lucide-loader-circle"
            class="size-4 animate-spin"
          />
          <svg
            v-else-if="provider.id === 'google'"
            viewBox="0 0 24 24"
            class="size-4"
            aria-hidden="true"
          >
            <path
              fill="#4285F4"
              d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-1.99 3.02v2.51h3.23c1.89-1.74 2.98-4.3 2.98-7.36Z"
            />
            <path
              fill="#34A853"
              d="M12 22c2.7 0 4.96-.9 6.62-2.41l-3.23-2.51c-.9.6-2.05.96-3.39.96-2.6 0-4.81-1.76-5.6-4.12H3.06v2.59A10 10 0 0 0 12 22Z"
            />
            <path
              fill="#FBBC05"
              d="M6.4 13.92a6 6 0 0 1 0-3.84V7.49H3.06a10 10 0 0 0 0 9.02l3.34-2.59Z"
            />
            <path
              fill="#EA4335"
              d="M12 5.96c1.47 0 2.79.5 3.82 1.49l2.87-2.87A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.94 5.49l3.34 2.59C7.19 7.72 9.4 5.96 12 5.96Z"
            />
          </svg>
          <UIcon
            v-else
            :name="provider.id === 'github' ? 'i-lucide-github' : 'i-lucide-shield-check'"
            class="size-4"
          />
        </template>
      </UButton>
    </div>
    <div
      v-if="configError"
      class="flex items-center justify-between gap-3 text-sm text-[#62789C]"
      role="status"
    >
      <p>Other sign-in options could not be loaded.</p>
      <UButton
        label="Retry"
        variant="link"
        :loading="status === 'pending'"
        @click="refresh()"
      />
    </div>
  </div>
</template>
