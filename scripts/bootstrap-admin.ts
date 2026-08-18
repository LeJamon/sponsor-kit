import { eq } from 'drizzle-orm'
import { auth } from '../lib/auth'
import { account, platformControls, user } from '../server/database/schema'
import { useDatabase } from '../server/utils/database'

const LOCAL_EMAIL = 'admin@acme.local'
const LOCAL_PASSWORD = 'AcmeLocalAdmin!2026'
const LOCAL_NAME = 'ACME Local Admin'

function isLocalDatabase(databaseUrl: string): boolean {
  const url = new URL(databaseUrl)
  return ['localhost', '127.0.0.1', '::1'].includes(url.hostname)
}

async function bootstrap() {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error('DATABASE_URL is required')

  const allowLocalDefaults = process.argv.includes('--local-defaults')
  const hasExplicitCredentials = Boolean(process.env.ACME_BOOTSTRAP_ADMIN_EMAIL || process.env.ACME_BOOTSTRAP_ADMIN_PASSWORD)
  if (hasExplicitCredentials && (!process.env.ACME_BOOTSTRAP_ADMIN_EMAIL || !process.env.ACME_BOOTSTRAP_ADMIN_PASSWORD)) {
    throw new Error('Set both ACME_BOOTSTRAP_ADMIN_EMAIL and ACME_BOOTSTRAP_ADMIN_PASSWORD')
  }
  if (!hasExplicitCredentials && (!allowLocalDefaults || !isLocalDatabase(databaseUrl) || process.env.NODE_ENV === 'production')) {
    throw new Error('Default administrator credentials require --local-defaults, a local database, and a non-production environment')
  }

  const email = (process.env.ACME_BOOTSTRAP_ADMIN_EMAIL || LOCAL_EMAIL).trim().toLowerCase()
  const password = process.env.ACME_BOOTSTRAP_ADMIN_PASSWORD || LOCAL_PASSWORD
  const name = (process.env.ACME_BOOTSTRAP_ADMIN_NAME || LOCAL_NAME).trim()
  if (password.length < 16) throw new Error('Bootstrap administrator password must contain at least 16 characters')

  const database = useDatabase()
  const existing = await database.query.user.findFirst({ where: eq(user.email, email) })
  if (existing) {
    const credential = await database.query.account.findFirst({ where: eq(account.userId, existing.id) })
    if (!credential) throw new Error(`Cannot promote ${email}: the user has no authentication account`)
    if (existing.role !== 'admin') await database.update(user).set({ role: 'admin', emailVerified: true }).where(eq(user.id, existing.id))
    await database.insert(platformControls).values({ key: 'sponsorship', paused: false, reason: null, updatedBy: existing.id }).onConflictDoNothing()
    console.log(`Administrator ready: ${email}`)
    return
  }

  await auth.api.createUser({ body: { email, password, name, role: 'admin' } })
  const created = await database.query.user.findFirst({ where: eq(user.email, email) })
  if (!created || created.role !== 'admin') throw new Error('Administrator bootstrap verification failed')
  await database.insert(platformControls).values({ key: 'sponsorship', paused: false, reason: null, updatedBy: created.id }).onConflictDoNothing()
  console.log(`Administrator created: ${email}`)
}

await bootstrap()
