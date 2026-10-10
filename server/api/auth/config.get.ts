import { isPasswordResetEnabled } from '~~/server/utils/password-reset'

export default defineEventHandler((event) => {
  setResponseHeader(event, 'Cache-Control', 'private, no-store')
  return { passwordResetEnabled: isPasswordResetEnabled() }
})
