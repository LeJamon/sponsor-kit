import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { admin } from 'better-auth/plugins'
import { useDatabase } from '../server/utils/database'
import * as schema from '../server/database/schema'

export const auth = betterAuth({
  database: drizzleAdapter(useDatabase(), { provider: 'pg', schema }),
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.NUXT_PUBLIC_APP_URL || 'http://localhost:3000',
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 12,
    maxPasswordLength: 128
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24
  },
  plugins: [admin()],
  advanced: {
    useSecureCookies: process.env.NODE_ENV === 'production'
  }
})
