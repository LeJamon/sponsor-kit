import { getAuthTables } from 'better-auth/db'
import { admin } from 'better-auth/plugins'
import { getTableColumns } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { account, session, user, verification } from '../server/database/schema'

describe('Better Auth database schema', () => {
  it('contains every field required by the installed Better Auth version', () => {
    const expected = getAuthTables({ emailAndPassword: { enabled: true }, plugins: [admin()] })

    expect(Object.keys(getTableColumns(user))).toEqual(expect.arrayContaining(Object.keys(expected.user.fields)))
    expect(Object.keys(getTableColumns(session))).toEqual(expect.arrayContaining(Object.keys(expected.session.fields)))
    expect(Object.keys(getTableColumns(account))).toEqual(expect.arrayContaining(Object.keys(expected.account.fields)))
    expect(Object.keys(getTableColumns(verification))).toEqual(expect.arrayContaining(Object.keys(expected.verification.fields)))
    expect(getTableColumns(account).issuer.notNull).toBe(false)
  })
})
