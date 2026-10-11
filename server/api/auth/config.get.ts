import { isPasswordResetEnabled } from '~~/server/utils/password-reset'
import { getPublicAuthProviderConfiguration } from '~~/lib/auth-providers'

export default defineEventHandler((event) => {
  setResponseHeader(event, 'Cache-Control', 'private, no-store')
  return {
    passwordResetEnabled: isPasswordResetEnabled(),
    ...getPublicAuthProviderConfiguration()
  }
})
