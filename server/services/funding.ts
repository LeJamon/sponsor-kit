import { and, desc, eq } from 'drizzle-orm'
import { fundingBalances, fundingLedgerEntries, sponsorAccounts } from '../database/schema'
import { useDatabase } from '../utils/database'
import { xrplRpc } from '../utils/xrpl-rpc'

export async function readProjectFunding(input: { projectId: string, rpcUrl: string, network: 'mainnet' | 'testnet' | 'devnet' }) {
  const database = useDatabase()
  const [sponsor] = await database.select().from(sponsorAccounts).where(and(eq(sponsorAccounts.projectId, input.projectId), eq(sponsorAccounts.network, input.network))).limit(1)
  if (!sponsor) return null
  const [accountInfo, serverState] = await Promise.all([
    xrplRpc<{ account_data: { Balance: string, OwnerCount?: number, SponsoredOwnerCount?: number, SponsoringOwnerCount?: number, SponsoringAccountCount?: number, Sponsor?: string }, ledger_index: number }>(input.rpcUrl, 'account_info', { account: sponsor.address, ledger_index: 'validated', strict: true }),
    xrplRpc<{ state: { validated_ledger: { reserve_base: string | number, reserve_inc: string | number } } }>(input.rpcUrl, 'server_state', {})
  ])
  const accountReserveDrops = BigInt(serverState.state.validated_ledger.reserve_base)
  const objectReserveDrops = BigInt(serverState.state.validated_ledger.reserve_inc)
  const account = accountInfo.account_data
  const objectCount = BigInt(Math.max(0, (account.OwnerCount || 0) + (account.SponsoringOwnerCount || 0) - (account.SponsoredOwnerCount || 0)))
  const accountCount = BigInt(account.SponsoringAccountCount || 0)
  const currentReserveDrops = (account.Sponsor ? 0n : accountReserveDrops) + objectReserveDrops * objectCount + accountReserveDrops * accountCount
  const observedBalanceDrops = BigInt(account.Balance)
  await database.update(sponsorAccounts).set({ observedBalanceDrops, reconciledAt: new Date() }).where(eq(sponsorAccounts.id, sponsor.id))
  await database.insert(fundingBalances).values({ sponsorAccountId: sponsor.id }).onConflictDoNothing()
  const [balance, entries] = await Promise.all([
    database.select().from(fundingBalances).where(eq(fundingBalances.sponsorAccountId, sponsor.id)).limit(1).then(rows => rows[0]),
    database.select().from(fundingLedgerEntries).where(eq(fundingLedgerEntries.sponsorAccountId, sponsor.id)).orderBy(desc(fundingLedgerEntries.createdAt)).limit(50)
  ])
  const availableDrops = observedBalanceDrops - currentReserveDrops - sponsor.safetyBufferDrops - (balance?.pendingFeeDrops || 0n) - (balance?.pendingReserveDrops || 0n)
  return {
    sponsor: { ...sponsor, observedBalanceDrops: observedBalanceDrops.toString(), safetyBufferDrops: sponsor.safetyBufferDrops.toString(), ledgerIndex: accountInfo.ledger_index },
    balance: {
      pendingFeeDrops: (balance?.pendingFeeDrops || 0n).toString(),
      capturedFeeDrops: (balance?.capturedFeeDrops || 0n).toString(),
      pendingReserveDrops: (balance?.pendingReserveDrops || 0n).toString(),
      lockedReserveDrops: (balance?.lockedReserveDrops || 0n).toString(),
      currentReserveDrops: currentReserveDrops.toString(),
      availableDrops: (availableDrops > 0n ? availableDrops : 0n).toString()
    },
    entries: entries.map(entry => ({ ...entry, feeDrops: entry.feeDrops.toString(), reserveDrops: entry.reserveDrops.toString() }))
  }
}
