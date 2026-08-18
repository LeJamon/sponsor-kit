import { and, count, desc, eq, inArray, isNull, lte } from 'drizzle-orm'
import { auditLogs, fundingBalances, networkSnapshots, outboxEvents, platformControls, projects, sponsorAccounts, sponsorshipIntents, workerHeartbeats } from '~~/server/database/schema'
import { createSponsorSigner } from '~~/server/services/signer/factory'
import { requirePlatformAdmin } from '~~/server/utils/admin'
import { useDatabase } from '~~/server/utils/database'
import { xrplRpc } from '~~/server/utils/xrpl-rpc'

export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event)
  const database = useDatabase()
  const now = new Date()
  const [projectCount, pendingIntentCount, validatedIntentCount, failedIntentCount, pendingOutboxCount, sponsors, balances, controlRows, snapshots, heartbeats, audits, oldestOutbox, sampleProject] = await Promise.all([
    database.select({ value: count() }).from(projects).where(eq(projects.status, 'active')),
    database.select({ value: count() }).from(sponsorshipIntents).where(inArray(sponsorshipIntents.state, ['created', 'awaiting_user_signature', 'user_signature_received', 'verified', 'awaiting_sponsor_signature', 'submitting', 'submitted'])),
    database.select({ value: count() }).from(sponsorshipIntents).where(eq(sponsorshipIntents.state, 'validated')),
    database.select({ value: count() }).from(sponsorshipIntents).where(inArray(sponsorshipIntents.state, ['failed', 'rejected', 'expired', 'cancelled'])),
    database.select({ value: count() }).from(outboxEvents).where(and(isNull(outboxEvents.processedAt), isNull(outboxEvents.deadLetteredAt), lte(outboxEvents.availableAt, now))),
    database.select().from(sponsorAccounts),
    database.select().from(fundingBalances),
    database.select().from(platformControls).where(eq(platformControls.key, 'sponsorship')).limit(1),
    database.select().from(networkSnapshots).orderBy(desc(networkSnapshots.observedAt)).limit(5),
    database.select().from(workerHeartbeats).orderBy(desc(workerHeartbeats.lastHeartbeatAt)),
    database.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(20),
    database.select({ createdAt: outboxEvents.createdAt }).from(outboxEvents).where(and(isNull(outboxEvents.processedAt), isNull(outboxEvents.deadLetteredAt))).orderBy(outboxEvents.createdAt).limit(1),
    database.select().from(projects).where(eq(projects.status, 'active')).limit(1)
  ])
  const balanceBySponsor = new Map(balances.map(balance => [balance.sponsorAccountId, balance]))
  const funding = sponsors.reduce((total, sponsor) => {
    const balance = balanceBySponsor.get(sponsor.id)
    return {
      observedBalanceDrops: total.observedBalanceDrops + sponsor.observedBalanceDrops,
      pendingFeeDrops: total.pendingFeeDrops + (balance?.pendingFeeDrops || 0n),
      pendingReserveDrops: total.pendingReserveDrops + (balance?.pendingReserveDrops || 0n),
      lockedReserveDrops: total.lockedReserveDrops + (balance?.lockedReserveDrops || 0n)
    }
  }, { observedBalanceDrops: 0n, pendingFeeDrops: 0n, pendingReserveDrops: 0n, lockedReserveDrops: 0n })

  let signer: { ok: boolean, provider: string, keyReference?: string, address?: string, error?: string }
  const project = sampleProject[0] || { rpcUrl: process.env.ACME_XRPL_RPC_URL || 'https://s.devnet.rippletest.net:51234/', network: 'devnet' }
  let liveNetwork: OverviewNetworkObservation | undefined
  try {
    const created = await createSponsorSigner({ rpcUrl: project.rpcUrl, network: project.network })
    const [identity, info] = await Promise.all([
      created.signer.getIdentity(),
      xrplRpc<{ info: { validated_ledger: { seq: number } } }>(project.rpcUrl, 'server_info', {})
    ])
    signer = { ok: true, provider: created.signer.provider, keyReference: identity.keyReference, address: identity.address }
    liveNetwork = { id: 'live', network: 'devnet', networkId: created.protocol.networkId, ledgerIndex: info.info.validated_ledger.seq, definitionsHash: created.protocol.definitionsHash, amendmentId: created.protocol.amendmentId, serverVersion: created.protocol.serverVersion, endpointHealthy: true, observedAt: now }
  } catch (error) {
    signer = { ok: false, provider: 'local', error: error instanceof Error ? error.message : 'Unavailable' }
  }
  const staleAfterMs = 60_000
  return {
    checkedAt: now.toISOString(),
    control: controlRows[0] || { key: 'sponsorship', paused: false, version: 0, reason: null, updatedAt: null },
    metrics: {
      activeProjects: projectCount[0]?.value || 0,
      pendingIntents: pendingIntentCount[0]?.value || 0,
      validatedIntents: validatedIntentCount[0]?.value || 0,
      failedIntents: failedIntentCount[0]?.value || 0,
      sponsorAccounts: sponsors.length,
      observedBalanceDrops: funding.observedBalanceDrops.toString(),
      pendingFeeDrops: funding.pendingFeeDrops.toString(),
      pendingReserveDrops: funding.pendingReserveDrops.toString(),
      lockedReserveDrops: funding.lockedReserveDrops.toString(),
      pendingOutbox: pendingOutboxCount[0]?.value || 0,
      oldestPendingOutboxAt: oldestOutbox[0]?.createdAt || null
    },
    services: {
      database: { ok: true },
      signer,
      workers: heartbeats.map(worker => ({ ...worker, stale: now.getTime() - worker.lastHeartbeatAt.getTime() > staleAfterMs }))
    },
    network: snapshots.length
      ? snapshots.map(snapshot => ({
          ...snapshot,
          baseFeeDrops: snapshot.baseFeeDrops.toString(),
          accountReserveDrops: snapshot.accountReserveDrops.toString(),
          objectReserveDrops: snapshot.objectReserveDrops.toString()
        }))
      : liveNetwork ? [liveNetwork] : [],
    audit: audits
  }
})

type OverviewNetworkObservation = {
  id: string
  network: 'devnet'
  networkId: number
  ledgerIndex: number
  definitionsHash: string
  amendmentId: string
  serverVersion: string
  endpointHealthy: boolean
  observedAt: Date
}
