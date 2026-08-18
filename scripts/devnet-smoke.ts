import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { encode, encodeForSigning, XrplDefinitions } from 'ripple-binary-codec'
import { deriveAddress, deriveKeypair, generateSeed, sign, verify } from 'ripple-keypairs'

const appUrl = process.env.ACME_SMOKE_APP_URL || 'http://localhost:3000'
const rpcUrl = process.env.ACME_XRPL_RPC_URL || 'https://s.devnet.rippletest.net:51234/'
const faucetUrl = process.env.ACME_XRPL_FAUCET_URL || 'https://faucet.devnet.rippletest.net/accounts'
const sponsorAddress = process.env.ACME_LOCAL_SPONSOR_ADDRESS
if (!sponsorAddress) throw new Error('ACME_LOCAL_SPONSOR_ADDRESS is required')

async function json<T>(url: string, init: RequestInit = {}): Promise<{ data: T, response: Response }> {
  const response = await fetch(url, init)
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText} for ${new URL(url).pathname}`)
  return { data: await response.json() as T, response }
}

async function rpc<T>(method: string, params: Record<string, unknown>): Promise<T> {
  const { data } = await json<{ result: T & { error?: string } }>(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method, params: [params] })
  })
  if (data.result.error) throw new Error(`XRPL ${method} returned ${data.result.error}`)
  return data.result
}

async function waitForAccount(address: string) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      return await rpc<{ account_data: { Balance: string, Sequence: number } }>('account_info', { account: address, ledger_index: 'validated', strict: true })
    } catch {
      await new Promise(resolve => setTimeout(resolve, 2_000))
    }
  }
  throw new Error('Faucet-funded account did not appear in a validated ledger')
}

const health = await json<{ status: string, checks: Record<string, { ok: boolean }> }>(`${appUrl}/api/v1/health`)
assert.equal(health.data.status, 'ok')
assert.ok(Object.values(health.data.checks).every(check => check.ok))

const sponseeSeed = generateSeed({ algorithm: 'ed25519' })
const sponseeKeypair = deriveKeypair(sponseeSeed)
const sponseeAddress = deriveAddress(sponseeKeypair.publicKey)
await json(faucetUrl, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ destination: sponseeAddress })
})
const before = await waitForAccount(sponseeAddress)

const runId = randomBytes(8).toString('hex')
const email = `smoke-${runId}@example.invalid`
const password = `Smoke-${randomBytes(18).toString('base64url')}!`
const signup = await json<{ user: { id: string } }>(`${appUrl}/api/auth/sign-up/email`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'origin': appUrl },
  body: JSON.stringify({ name: 'Devnet Smoke', email, password })
})
const cookie = signup.response.headers.get('set-cookie')?.split(';')[0]
if (!cookie) throw new Error('Authentication cookie was not returned')
const sessionHeaders = { 'content-type': 'application/json', cookie, 'origin': appUrl }
const onboarding = await json<{ project: { publicId: string } }>(`${appUrl}/api/onboarding`, {
  method: 'POST', headers: sessionHeaders, body: JSON.stringify({ organizationName: `Devnet Smoke ${runId}` })
})
const projectId = onboarding.data.project.publicId
const keyResponse = await json<{ secret: string }>(`${appUrl}/api/console/projects/${projectId}/api-keys`, {
  method: 'POST', headers: sessionHeaders, body: JSON.stringify({ name: 'Devnet smoke', scopes: ['intents:create', 'intents:read'] })
})
const apiHeaders = { 'content-type': 'application/json', 'authorization': `Bearer ${keyResponse.data.secret}` }
const created = await json<{
  id: string
  state: string
  grant: string
  definitionsHash: string
  transaction: Record<string, unknown>
}>(`${appUrl}/api/v1/projects/${projectId}/intents`, {
  method: 'POST',
  headers: { ...apiHeaders, 'idempotency-key': `smoke-${runId}` },
  body: JSON.stringify({
    account: sponseeAddress,
    transaction: { TransactionType: 'Payment', Destination: sponsorAddress, Amount: '1' },
    sponsorship: { fee: true, reserve: false },
    signing: { mode: 'single', signerCount: 1 }
  })
})
assert.equal(created.data.state, 'awaiting_user_signature')
assert.equal(created.data.transaction.Sponsor, sponsorAddress)
assert.equal(created.data.transaction.SponsorFlags, 1)

const definitionsResult = await rpc<ConstructorParameters<typeof XrplDefinitions>[0] & { hash?: string }>('server_definitions', {})
assert.equal(definitionsResult.hash, created.data.definitionsHash)
const definitions = new XrplDefinitions(definitionsResult)
const walletTransaction = { ...created.data.transaction, SigningPubKey: sponseeKeypair.publicKey }
const signingPayload = encodeForSigning(walletTransaction, definitions)
const walletSignature = sign(signingPayload, sponseeKeypair.privateKey)
assert.ok(verify(signingPayload, walletSignature, sponseeKeypair.publicKey))
const userSignedBlob = encode({ ...walletTransaction, TxnSignature: walletSignature }, definitions)
const authorized = await json<{ transactionHash: string, state: string }>(`${appUrl}/api/v1/intents/${created.data.id}/authorize`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ grant: created.data.grant, signedTransaction: userSignedBlob })
})
assert.equal(authorized.data.state, 'submitting')
assert.match(authorized.data.transactionHash, /^[A-F0-9]{64}$/)

let finalIntent: { state: string, submissions: Array<{ transactionHash: string, ledgerIndex: number | null, validatedAt: string | null }> } | undefined
for (let attempt = 0; attempt < 40; attempt += 1) {
  const current = await json<typeof finalIntent>(`${appUrl}/api/v1/intents/${created.data.id}`, { headers: apiHeaders })
  finalIntent = current.data
  if (['validated', 'failed', 'expired'].includes(finalIntent!.state)) break
  await new Promise(resolve => setTimeout(resolve, 2_000))
}
assert.equal(finalIntent?.state, 'validated')
assert.equal(finalIntent.submissions[0]?.transactionHash, authorized.data.transactionHash)
assert.ok(finalIntent.submissions[0]?.validatedAt)

const validated = await rpc<{ validated: boolean, meta: { TransactionResult: string }, tx_json?: Record<string, unknown>, Account?: string, Sponsor?: string, SponsorFlags?: number }>('tx', { transaction: authorized.data.transactionHash, binary: false })
assert.equal(validated.validated, true)
assert.equal(validated.meta.TransactionResult, 'tesSUCCESS')
const transaction = validated.tx_json || validated
assert.equal(transaction.Account, sponseeAddress)
assert.equal(transaction.Sponsor, sponsorAddress)
assert.equal(transaction.SponsorFlags, 1)
const after = await waitForAccount(sponseeAddress)
assert.equal(BigInt(before.account_data.Balance) - BigInt(after.account_data.Balance), 1n)

const migrationPlan = await json<{ id: string }>(`${appUrl}/api/console/projects/${projectId}/reserve-migration-plans`, {
  method: 'POST', headers: sessionHeaders, body: JSON.stringify({ account: sponseeAddress })
})
const migration = await json<{ targets: Array<{ id: string, objectType: string, classification: string }> }>(`${appUrl}/api/console/projects/${projectId}/reserve-migration-plans/${migrationPlan.data.id}`, { headers: { cookie } })
const accountTarget = migration.data.targets.find(target => target.objectType === 'AccountRoot')
assert.equal(accountTarget?.classification, 'eligible')
const transferIntent = await json<{
  id: string
  grant: string
  transaction: Record<string, unknown>
}>(`${appUrl}/api/console/projects/${projectId}/reserve-migration-plans/${migrationPlan.data.id}/targets/${accountTarget!.id}/intent`, {
  method: 'POST', headers: sessionHeaders
})
const transferTransaction = { ...transferIntent.data.transaction, SigningPubKey: sponseeKeypair.publicKey }
const transferPayload = encodeForSigning(transferTransaction, definitions)
const transferSignature = sign(transferPayload, sponseeKeypair.privateKey)
const transferBlob = encode({ ...transferTransaction, TxnSignature: transferSignature }, definitions)
const transferAuthorized = await json<{ transactionHash: string }>(`${appUrl}/api/v1/intents/${transferIntent.data.id}/authorize`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ grant: transferIntent.data.grant, signedTransaction: transferBlob })
})
let transferState = ''
for (let attempt = 0; attempt < 40; attempt += 1) {
  const current = await json<{ state: string }>(`${appUrl}/api/v1/intents/${transferIntent.data.id}`, { headers: apiHeaders })
  transferState = current.data.state
  if (['validated', 'failed', 'expired'].includes(transferState)) break
  await new Promise(resolve => setTimeout(resolve, 2_000))
}
assert.equal(transferState, 'validated')
const sponsoredAccount = await rpc<{ account_data: { Sponsor?: string, Sequence: number } }>('account_info', { account: sponseeAddress, ledger_index: 'validated', strict: true })
assert.equal(sponsoredAccount.account_data.Sponsor, sponsorAddress)

const fee = await rpc<{ drops: { open_ledger_fee: string } }>('fee', {})
const server = await rpc<{ info: { validated_ledger: { seq: number } } }>('server_info', {})
const transferFlags = definitionsResult.TRANSACTION_FLAGS.SponsorshipTransfer
const cleanupTransaction = {
  TransactionType: 'SponsorshipTransfer',
  Account: sponseeAddress,
  Flags: transferFlags.tfSponsorshipEnd,
  Fee: fee.drops.open_ledger_fee,
  Sequence: sponsoredAccount.account_data.Sequence,
  LastLedgerSequence: server.info.validated_ledger.seq + 20,
  SigningPubKey: sponseeKeypair.publicKey
}
const cleanupSignature = sign(encodeForSigning(cleanupTransaction, definitions), sponseeKeypair.privateKey)
const cleanupBlob = encode({ ...cleanupTransaction, TxnSignature: cleanupSignature }, definitions)
const cleanup = await rpc<{ engine_result: string, tx_json: { hash: string } }>('submit', { tx_blob: cleanupBlob, fail_hard: false })
assert.ok(cleanup.engine_result.startsWith('tes') || cleanup.engine_result.startsWith('ter'))
for (let attempt = 0; attempt < 40; attempt += 1) {
  try {
    const transactionResult = await rpc<{ validated: boolean, meta: { TransactionResult: string } }>('tx', { transaction: cleanup.tx_json.hash, binary: false })
    if (transactionResult.validated) {
      assert.equal(transactionResult.meta.TransactionResult, 'tesSUCCESS')
      break
    }
  } catch {
    await new Promise(resolve => setTimeout(resolve, 2_000))
  }
}
const releasedAccount = await rpc<{ account_data: { Sponsor?: string } }>('account_info', { account: sponseeAddress, ledger_index: 'validated', strict: true })
assert.equal(releasedAccount.account_data.Sponsor, undefined)
let lockedReserveDrops = ''
for (let attempt = 0; attempt < 20; attempt += 1) {
  const funding = await json<{ balance: { lockedReserveDrops: string } }>(`${appUrl}/api/console/projects/${projectId}/funding`, { headers: { cookie } })
  lockedReserveDrops = funding.data.balance.lockedReserveDrops
  if (lockedReserveDrops === '0') break
  await new Promise(resolve => setTimeout(resolve, 1_000))
}
assert.equal(lockedReserveDrops, '0')

console.log(JSON.stringify({ ok: true, projectId, paymentIntentId: created.data.id, paymentHash: authorized.data.transactionHash, migrationIntentId: transferIntent.data.id, migrationHash: transferAuthorized.data.transactionHash, cleanupHash: cleanup.tx_json.hash }))
