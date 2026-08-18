import { randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { auth } from '~~/lib/auth'
import { fundingBalances, networkSnapshots, organizationMemberships, organizations, projects, sponsorAccounts, sponsorshipPolicies } from '~~/server/database/schema'
import { canonicalHash } from '~~/server/domain/canonical-json'
import { loadSponsorProtocolDefinitions, parseDefinitionsHashAllowlist } from '~~/server/services/xrpl/definitions'
import { useDatabase } from '~~/server/utils/database'
import { xrplRpc } from '~~/server/utils/xrpl-rpc'

const schema = z.object({ organizationName: z.string().trim().min(2).max(80) })

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  const parsed = schema.safeParse(await readBody(event))
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Invalid organization', data: parsed.error.flatten() })
  const database = useDatabase()
  const [existing] = await database.select({ organization: organizations, project: projects }).from(organizationMemberships)
    .innerJoin(organizations, eq(organizations.id, organizationMemberships.organizationId))
    .innerJoin(projects, eq(projects.organizationId, organizations.id))
    .where(eq(organizationMemberships.userId, session.user.id)).limit(1)
  if (existing) return existing

  const rpcUrl = process.env.ACME_XRPL_RPC_URL || 'https://s.devnet.rippletest.net:51234/'
  const sponsorAddress = process.env.ACME_LOCAL_SPONSOR_ADDRESS
  if (!sponsorAddress) throw createError({ statusCode: 503, statusMessage: 'Sponsor account is not configured' })
  const [protocol, sponsorInfo, serverState] = await Promise.all([
    loadSponsorProtocolDefinitions({ rpcUrl, allowedHashes: parseDefinitionsHashAllowlist(process.env.ACME_XRPL_DEFINITIONS_HASHES) }),
    xrplRpc<{ account_data: { Balance: string }, ledger_index: number }>(rpcUrl, 'account_info', { account: sponsorAddress, ledger_index: 'validated', strict: true }),
    xrplRpc<{ state: { validated_ledger: { base_fee: string | number, reserve_base: string | number, reserve_inc: string | number, seq: number } } }>(rpcUrl, 'server_state', {})
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
  const suffix = randomBytes(4).toString('hex')
  const slugBase = parsed.data.organizationName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'organization'
  const result = await database.transaction(async (tx) => {
    const [organization] = await tx.insert(organizations).values({ name: parsed.data.organizationName, slug: `${slugBase}-${suffix}` }).returning()
    if (!organization) throw new Error('Organization creation failed')
    await tx.insert(organizationMemberships).values({ organizationId: organization.id, userId: session.user.id, role: 'owner' })
    const [project] = await tx.insert(projects).values({ organizationId: organization.id, name: 'My first project', publicId: `proj_${randomBytes(8).toString('hex')}`, environment: 'development', network: 'devnet', rpcUrl }).returning()
    if (!project) throw new Error('Project creation failed')
    const [sponsor] = await tx.insert(sponsorAccounts).values({ projectId: project.id, network: 'devnet', address: sponsorAddress, signerProvider: 'local', signerKeyReference: 'local-v1', capabilities: { fee: true, reserve: true }, safetyBufferDrops: 10_000_000n, observedBalanceDrops: BigInt(sponsorInfo.account_data.Balance), reconciledAt: new Date() }).returning()
    if (!sponsor) throw new Error('Sponsor account creation failed')
    await tx.insert(fundingBalances).values({ sponsorAccountId: sponsor.id })
    await tx.insert(sponsorshipPolicies).values({ projectId: project.id, name: 'Default sponsorship', version: 1, status: 'active', document: policyDocument, documentHash: canonicalHash(policyDocument), publishedBy: session.user.id, publishedAt: new Date() })
    await tx.insert(networkSnapshots).values({ projectId: project.id, network: 'devnet', networkId: protocol.networkId, definitionsHash: protocol.definitionsHash, amendmentId: protocol.amendmentId, serverVersion: protocol.serverVersion, rpcUrl, ledgerIndex: serverState.state.validated_ledger.seq, capabilities: { fee: true, reserve: true, sponsorshipSet: true, sponsorshipTransfer: true }, baseFeeDrops: BigInt(serverState.state.validated_ledger.base_fee), accountReserveDrops: BigInt(serverState.state.validated_ledger.reserve_base), objectReserveDrops: BigInt(serverState.state.validated_ledger.reserve_inc), endpointHealthy: true })
    return { organization, project }
  })
  setResponseStatus(event, 201)
  return result
})
