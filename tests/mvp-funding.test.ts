import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { fundingBalances, organizations, projectFundingBudgets, projectFundingQuotas, projectSponsorAccounts, projects, sponsorAccounts, sponsorTreasuries } from '../server/database/schema'
import { FundingCapacityError, reserveFundingCapacity } from '../server/services/funding'

const databaseUrl = process.env.MVP_FUNDING_TEST_DATABASE_URL
const runDatabaseTests = Boolean(databaseUrl)
const client = databaseUrl ? postgres(databaseUrl, { max: 8, prepare: false }) : undefined
const database = client ? drizzle(client) : undefined

describe.skipIf(!runDatabaseTests)('MVP funding capacity integration', () => {
  const ids = {
    organization: randomUUID(),
    projectA: randomUUID(),
    projectB: randomUUID(),
    treasury: randomUUID(),
    accountA: randomUUID(),
    accountB: randomUUID()
  }

  beforeAll(async () => {
    if (!database) return
    await database.insert(organizations).values({ id: ids.organization, name: 'Funding test', slug: `funding-${ids.organization}` })
    await database.insert(projects).values([
      { id: ids.projectA, organizationId: ids.organization, name: 'Project A', publicId: `funding-a-${ids.projectA}`, network: 'devnet', rpcUrl: 'http://test.invalid' },
      { id: ids.projectB, organizationId: ids.organization, name: 'Project B', publicId: `funding-b-${ids.projectB}`, network: 'devnet', rpcUrl: 'http://test.invalid' }
    ])
    await database.insert(sponsorTreasuries).values({ id: ids.treasury, network: 'devnet', address: `rFunding${ids.treasury.replaceAll('-', '').slice(0, 25)}`, signerKeyReference: 'test', capabilities: { fee: true, reserve: true }, observedBalanceDrops: 1_000_000_000n })
    await database.insert(sponsorAccounts).values([
      { id: ids.accountA, projectId: ids.projectA, treasuryId: ids.treasury, network: 'devnet', address: 'rFundingA', signerKeyReference: 'test', capabilities: { fee: true, reserve: true } },
      { id: ids.accountB, projectId: ids.projectB, treasuryId: ids.treasury, network: 'devnet', address: 'rFundingB', signerKeyReference: 'test', capabilities: { fee: true, reserve: true } }
    ])
    await database.insert(projectSponsorAccounts).values([
      { projectId: ids.projectA, sponsorAccountId: ids.accountA, network: 'devnet' },
      { projectId: ids.projectB, sponsorAccountId: ids.accountB, network: 'devnet' }
    ])
    await database.insert(fundingBalances).values({ sponsorAccountId: ids.accountA, treasuryId: ids.treasury })
    await database.insert(projectFundingBudgets).values([
      { projectId: ids.projectA, feeBudgetDrops: 100n, reserveBudgetDrops: 100n, walletFeeQuotaDrops: 60n, walletReserveQuotaDrops: 100n },
      { projectId: ids.projectB, feeBudgetDrops: 100n, reserveBudgetDrops: 100n, walletFeeQuotaDrops: 100n, walletReserveQuotaDrops: 100n }
    ])
  })

  afterAll(async () => {
    if (!database || !client) return
    await database.delete(projectSponsorAccounts).where(sql`project_id in (${ids.projectA}, ${ids.projectB})`)
    await database.delete(projectFundingQuotas).where(sql`project_id in (${ids.projectA}, ${ids.projectB})`)
    await database.delete(projectFundingBudgets).where(sql`project_id in (${ids.projectA}, ${ids.projectB})`)
    await database.delete(fundingBalances).where(sql`treasury_id = ${ids.treasury}`)
    await database.delete(sponsorAccounts).where(sql`id in (${ids.accountA}, ${ids.accountB})`)
    await database.delete(sponsorTreasuries).where(sql`id = ${ids.treasury}`)
    await database.delete(projects).where(sql`id in (${ids.projectA}, ${ids.projectB})`)
    await database.delete(organizations).where(sql`id = ${ids.organization}`)
    await client.end()
  })

  it('serializes same-project quota races while isolating project budgets', async () => {
    if (!database) return
    const now = new Date('2026-01-01T00:00:00.000Z')
    const attempts = await Promise.allSettled([1, 2].map(() => database.transaction(tx => reserveFundingCapacity(tx, {
      sponsorAccountId: ids.accountA,
      treasuryId: ids.treasury,
      projectId: ids.projectA,
      accountAddress: 'rWalletA',
      feeDrops: 60n,
      reserveDrops: 0n,
      now
    }))))
    expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(attempts.filter(result => result.status === 'rejected' && result.reason instanceof FundingCapacityError)).toHaveLength(1)

    await expect(database.transaction(tx => reserveFundingCapacity(tx, {
      sponsorAccountId: ids.accountB,
      treasuryId: ids.treasury,
      projectId: ids.projectB,
      accountAddress: 'rWalletB',
      feeDrops: 60n,
      reserveDrops: 0n,
      now
    }))).resolves.toBeDefined()
  })
})
