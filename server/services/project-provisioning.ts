import { createHash } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { fundingBalances, networkSnapshots, projectFundingBudgets, projectSponsorAccounts, sponsorAccounts, sponsorTreasuries, sponsorshipPolicies } from '../database/schema'
import { canonicalHash } from '../domain/canonical-json'
import { fundingBudgetDefaults } from './funding'
import { loadSponsorProtocolDefinitions, parseDefinitionsHashAllowlist, type SponsorProtocolDefinitions } from '~~/server/services/xrpl/definitions'
import type { useDatabase } from '../utils/database'
import { xrplRpc } from '../utils/xrpl-rpc'

type DatabaseTransaction = Parameters<Parameters<ReturnType<typeof useDatabase>['transaction']>[0]>[0]

type SponsorInfo = {
  account_data: { Balance: string }
  ledger_index: number
}

type ServerState = {
  state: {
    validated_ledger: {
      base_fee: string | number
      reserve_base: string | number
      reserve_inc: string | number
      seq: number
    }
  }
}

export type ProjectProvisioningContext = {
  rpcUrl: string
  sponsorAddress: string
  protocol: SponsorProtocolDefinitions
  sponsorInfo: SponsorInfo
  serverState: ServerState
  policyDocument: Record<string, unknown>
}

/** Load the network state used to initialize both onboarding and new projects. */
export async function loadProjectProvisioningContext(): Promise<ProjectProvisioningContext> {
  const rpcUrl = process.env.ACME_XRPL_RPC_URL || 'https://s.devnet.rippletest.net:51234/'
  const sponsorAddress = process.env.ACME_LOCAL_SPONSOR_ADDRESS
  if (!sponsorAddress) throw createError({ statusCode: 503, statusMessage: 'Sponsor account is not configured' })
  const [protocol, sponsorInfo, serverState] = await Promise.all([
    loadSponsorProtocolDefinitions({ rpcUrl, allowedHashes: parseDefinitionsHashAllowlist(process.env.ACME_XRPL_DEFINITIONS_HASHES) }),
    xrplRpc<SponsorInfo>(rpcUrl, 'account_info', { account: sponsorAddress, ledger_index: 'validated', strict: true }),
    xrplRpc<ServerState>(rpcUrl, 'server_state', {})
  ])
  const policyDocument = {
    allowedTransactionTypes: protocol.transactionTypes,
    allowedDestinations: [],
    allowedFields: [],
    maximumFeeDrops: '10000',
    maximumReserveDrops: '1000000000',
    maximumIntentsPerWalletPerDay: 1000,
    intentTtlSeconds: 300,
    requireWalletProof: true
  }
  return { rpcUrl, sponsorAddress, protocol, sponsorInfo, serverState, policyDocument }
}

/**
 * Derive the public project identifier for a create-project request. The
 * request key is scoped to the authenticated user and organization, so the
 * same key can safely be used in two unrelated organizations.
 */
export function projectPublicIdForRequest(input: { userId: string, organizationId: string, requestId: string }): string {
  const digest = createHash('sha256').update(`${input.userId}\0${input.organizationId}\0${input.requestId}`).digest('hex')
  return `proj_${digest}`
}

/** Provision the rows that make a project ready for sponsorship. */
export async function provisionProject(tx: DatabaseTransaction, input: {
  projectId: string
  publishedBy: string
  context: ProjectProvisioningContext
}) {
  const { context } = input
  await tx.insert(sponsorTreasuries).values({
    network: 'devnet',
    address: context.sponsorAddress,
    signerProvider: 'local',
    signerKeyReference: 'local-v1',
    capabilities: { fee: true, reserve: true },
    safetyBufferDrops: 10_000_000n,
    observedBalanceDrops: BigInt(context.sponsorInfo.account_data.Balance),
    reconciledAt: new Date()
  }).onConflictDoNothing()
  const [treasury] = await tx.select().from(sponsorTreasuries)
    .where(and(eq(sponsorTreasuries.network, 'devnet'), eq(sponsorTreasuries.address, context.sponsorAddress)))
    .for('update').limit(1)
  if (!treasury) throw new Error('Sponsor treasury creation failed')

  const [sponsor] = await tx.insert(sponsorAccounts).values({
    projectId: input.projectId,
    treasuryId: treasury.id,
    network: 'devnet',
    address: context.sponsorAddress,
    signerProvider: treasury.signerProvider,
    signerKeyReference: treasury.signerKeyReference,
    capabilities: treasury.capabilities,
    safetyBufferDrops: treasury.safetyBufferDrops,
    observedBalanceDrops: treasury.observedBalanceDrops,
    reconciledAt: treasury.reconciledAt
  }).returning()
  if (!sponsor) throw new Error('Sponsor account binding creation failed')
  await tx.insert(projectSponsorAccounts).values({ projectId: input.projectId, sponsorAccountId: sponsor.id, network: 'devnet' })
  await tx.insert(fundingBalances).values({ sponsorAccountId: sponsor.id, treasuryId: treasury.id }).onConflictDoNothing()
  await tx.insert(projectFundingBudgets).values({ projectId: input.projectId, ...fundingBudgetDefaults() }).onConflictDoNothing()
  await tx.insert(sponsorshipPolicies).values({
    projectId: input.projectId,
    name: 'Default sponsorship',
    version: 1,
    status: 'active',
    document: context.policyDocument,
    documentHash: canonicalHash(context.policyDocument),
    publishedBy: input.publishedBy,
    publishedAt: new Date()
  })
  const ledger = context.serverState.state.validated_ledger
  await tx.insert(networkSnapshots).values({
    projectId: input.projectId,
    network: 'devnet',
    networkId: context.protocol.networkId,
    definitionsHash: context.protocol.definitionsHash,
    amendmentId: context.protocol.amendmentId,
    serverVersion: context.protocol.serverVersion,
    rpcUrl: context.rpcUrl,
    ledgerIndex: ledger.seq,
    capabilities: { fee: true, reserve: true, sponsorshipSet: true, sponsorshipTransfer: true },
    baseFeeDrops: BigInt(ledger.base_fee),
    accountReserveDrops: BigInt(ledger.reserve_base),
    objectReserveDrops: BigInt(ledger.reserve_inc),
    endpointHealthy: true
  })
  return { sponsor, treasury }
}
