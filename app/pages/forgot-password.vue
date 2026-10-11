<script setup lang="ts">
import { authClient } from '~~/lib/auth-client'

const { data: config, status: configStatus, error: configError } = await useFetch<{ passwordResetEnabled: boolean }>('/api/auth/config')
const email = ref('')
const loading = ref(false)
const sent = ref(false)
const errorMessage = ref('')

async function submit() {
  if (!config.value?.passwordResetEnabled) {
    errorMessage.value = 'Password reset email is not configured for this environment. Contact the administrator.'
    return
  }
  loading.value = true
  errorMessage.value = ''
  try {
    const result = await authClient.requestPasswordReset({
      email: email.value.trim(),
      redirectTo: `${window.location.origin}/reset-password`
    })
    if (result.error) {
      errorMessage.value = result.error.message || 'Password reset could not be requested.'
      return
    }
    sent.value = true
  } catch {
    errorMessage.value = 'The password reset service is unavailable. Try again later.'
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
        Reset your password
      </h1>
      <p class="mt-2 text-sm leading-6 text-[#62789C]">
        Enter the email on your ACME account. If reset email is enabled, we’ll send a link that returns here.
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
        title="Password reset email is not configured"
        description="Password reset emails are not configured yet. Your account is unchanged; contact the administrator for recovery."
      />
      <UAlert
        v-if="sent"
        class="mt-5"
        color="success"
        variant="subtle"
        title="Check your inbox"
        description="If an account exists for that email, a reset link is on its way. The link expires and can only be used once."
      />
      <UAlert
        v-if="errorMessage"
        class="mt-5"
        color="error"
        variant="subtle"
        :description="errorMessage"
      />
      <form
        v-if="!sent"
        class="mt-7 space-y-5"
        @submit.prevent="submit"
      >
        <UFormField label="Email">
          <UInput
            v-model="email"
            type="email"
            autocomplete="email"
            class="w-full"
            size="lg"
            required
          />
        </UFormField>
        <UButton
          type="submit"
          label="Email reset link"
          block
          size="lg"
          :loading="loading"
          :disabled="configStatus === 'pending' || config?.passwordResetEnabled === false"
        />
      </form>
      <p class="mt-6 text-center text-sm text-[#62789C]">
        Remember your password? <NuxtLink
          to="/sign-in"
          class="font-semibold text-[#0A3DFF]"
        >Sign in</NuxtLink>
      </p>
    </div>
  </UContainer>
</template>
