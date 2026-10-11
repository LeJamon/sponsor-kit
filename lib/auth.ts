import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { admin } from 'better-auth/plugins'
import { useDatabase } from '../server/utils/database'
import * as schema from '../server/database/schema'
import { createPasswordResetSender } from '../server/utils/password-reset'
import { createAuthProviderOptions } from './auth-providers'

const sendResetPassword = createPasswordResetSender()
const authProviderOptions = createAuthProviderOptions()

export const auth = betterAuth({
  database: drizzleAdapter(useDatabase(), { provider: 'pg', schema }),
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.NUXT_PUBLIC_APP_URL || 'http://localhost:3000',
  socialProviders: authProviderOptions.socialProviders,
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 12,
    maxPasswordLength: 128,
    revokeSessionsOnPasswordReset: true,
    ...(sendResetPassword ? { sendResetPassword } : {})
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24
  },
  account: {
    encryptOAuthTokens: true,
    accountLinking: {
      disableImplicitLinking: true
    }
  },
  plugins: [admin(), ...authProviderOptions.plugins],
  advanced: {
    useSecureCookies: process.env.NODE_ENV === 'production'
  }
})
