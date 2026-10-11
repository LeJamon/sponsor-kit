<script setup lang="ts">
import { authClient } from '~~/lib/auth-client'

const route = useRoute()
const { data: config, status: configStatus, error: configError } = await useFetch<{ passwordResetEnabled: boolean }>('/api/auth/config')
const token = computed(() => typeof route.query.token === 'string' ? route.query.token : '')
const password = ref('')
const confirmation = ref('')
const loading = ref(false)
const complete = ref(false)
const errorMessage = ref(typeof route.query.error === 'string' ? 'This reset link is invalid or has expired. Request a new link.' : '')

async function submit() {
  errorMessage.value = ''
  if (!config.value?.passwordResetEnabled) {
    errorMessage.value = 'Password reset is not configured for this environment. Contact the administrator.'
    return
  }
  if (!token.value) {
    errorMessage.value = 'This page needs a reset token from your email. Request a new link to continue.'
    return
  }
  if (password.value !== confirmation.value) {
    errorMessage.value = 'Passwords do not match.'
    return
  }
  loading.value = true
  try {
    const result = await authClient.resetPassword({ newPassword: password.value, token: token.value })
    if (result.error) {
      errorMessage.value = result.error.message || 'The password could not be reset.'
      return
    }
    complete.value = true
  } catch {
    errorMessage.value = 'The password reset service is unavailable. Request a new link and try again.'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <UContainer class="grid min-h-[calc(100vh-145px)] place-items-center py-16">
    <div class="acme-card w-full max-w-md p-7 sm:p-9">
      <p class="acme-kicker">
        Account recovery
      </p>
      <h1 class="mt-3 text-2xl font-bold">
        Choose a new password
      </h1>
      <p class="mt-2 text-sm leading-6 text-[#62789C]">
        Use at least 12 characters. Your reset token is consumed after a successful change.
      </p>
      <UAlert
        v-if="configError"
        class="mt-5"
        color="error"
        title="Password reset availability is unknown"
        description="The environment did not return its email configuration. Try again later or contact the administrator."
      />
      <UAlert
        v-else-if="configStatus !== 'pending' && config?.passwordResetEnabled === false"
        class="mt-5"
        color="warning"
        variant="subtle"
        title="Password reset is not configured"
        description="Contact the administrator for recovery."
      />
      <UAlert
        v-if="errorMessage"
        class="mt-5"
        color="error"
        variant="subtle"
        :description="errorMessage"
      />
      <UAlert
        v-if="complete"
        class="mt-5"
        color="success"
        variant="subtle"
        title="Password updated"
        description="Your password has been changed. Sign in with the new password to return to the console."
      >
        <template #actions>
          <UButton
            to="/sign-in"
            label="Sign in"
            color="success"
            variant="soft"
          />
        </template>
      </UAlert>
      <form
        v-if="!complete"
        class="mt-7 space-y-5"
        @submit.prevent="submit"
      >
        <UFormField label="New password">
          <UInput
            v-model="password"
            type="password"
            autocomplete="new-password"
            minlength="12"
            class="w-full"
            size="lg"
            required
          />
        </UFormField>
        <UFormField label="Confirm new password">
          <UInput
            v-model="confirmation"
            type="password"
            autocomplete="new-password"
            minlength="12"
            class="w-full"
            size="lg"
            required
          />
        </UFormField>
        <UButton
          type="submit"
          label="Set new password"
          block
          size="lg"
          :loading="loading"
          :disabled="configStatus === 'pending' || config?.passwordResetEnabled === false || !token"
        />
      </form>
      <p class="mt-6 text-center text-sm text-[#62789C]">
        Need a new link? <NuxtLink
          to="/forgot-password"
          class="font-semibold text-[#0A3DFF]"
        >Request password reset</NuxtLink>
      </p>
    </div>
  </UContainer>
</template>
