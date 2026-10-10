import { randomUUID } from 'node:crypto'
import { encode, encodeForSigning, XrplDefinitions } from 'ripple-binary-codec'
import { deriveAddress, deriveKeypair, generateSeed, sign, verify } from 'ripple-keypairs'
import { isValidClassicAddress } from 'ripple-address-codec'
import { createAcmeClient } from './lib/acme.mjs'

async function main() {
  const client = createAcmeClient({
    baseUrl: process.env.ACME_BASE_URL || 'http://localhost:3000',
    projectId: process.env.ACME_PROJECT_ID,
    apiKey: process.env.ACME_API_KEY
  })
  const resume = process.argv.indexOf('--resume')
  if (resume >= 0) {
    const id = process.argv[resume + 1]
    if (!id || id.startsWith('--')) throw new Error('Provide an intent ID after --resume')
    return report(await client.waitForIntent(id))
  }
  if (!process.argv.includes('--confirm-devnet')) throw new Error('Pass --confirm-devnet to create a disposable wallet and send one Devnet drop. Never use real funds with this example.')
  const destination = process.env.ACME_EXAMPLE_DESTINATION
  if (!destination || !isValidClassicAddress(destination)) throw new Error('Set ACME_EXAMPLE_DESTINATION to a funded Devnet account, such as your sponsor address')
  const protocol = await client.protocol()
  if (protocol.network !== 'devnet' || protocol.networkId !== 2) throw new Error('The project must use XRPL Devnet')
  const keypair = deriveKeypair(generateSeed({ algorithm: 'ed25519' }))
  const account = deriveAddress(keypair.publicKey)
  console.log(`Disposable Devnet wallet: ${account}`)
  const faucet = await fetch('https://faucet.devnet.rippletest.net/accounts', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ destination: account }),
    redirect: 'error', signal: AbortSignal.timeout(20_000)
  })
  if (!faucet.ok) throw new Error(`Devnet faucet unavailable (${faucet.status}); no payment was prepared`)
  await faucet.body?.cancel()
  let funded = false
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const response = await fetch('https://s.devnet.rippletest.net:51234/', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'account_info', params: [{ account, ledger_index: 'validated', strict: true }] }),
      signal: AbortSignal.timeout(8_000)
    })
    if (response.ok && (await response.json()).result?.account_data) {
      funded = true
      break
    }
    await new Promise(resolve => setTimeout(resolve, 2_000))
  }
  if (!funded) throw new Error('Faucet funding was not validated in time; no payment was prepared')
  const intent = await client.createPayment({ account, destination, amountDrops: '1', operationId: randomUUID() })
  console.log(`Intent: ${intent.id}. If interrupted after authorization, use --resume ${intent.id}.`)
  if (intent.network !== 'devnet' || intent.networkId !== 2 || intent.definitionsHash !== protocol.definitionsHash || protocol.definitions.hash?.toUpperCase() !== intent.definitionsHash) throw new Error('Signing protocol changed; no transaction was signed')
  if (new Date(intent.expiresAt).getTime() <= Date.now()) throw new Error('Intent expired before signing')
  if (intent.transaction.Account !== account || intent.transaction.Destination !== destination || intent.transaction.Amount !== '1' || intent.transaction.TransactionType !== 'Payment') throw new Error('Prepared transaction does not match the requested payment')
  if (intent.transaction.SponsorSignature || intent.transaction.TxnSignature || intent.transaction.Signers) throw new Error('Prepared transaction already contains signatures')
  const definitions = new XrplDefinitions(protocol.definitions)
  const transaction = { ...intent.transaction, SigningPubKey: keypair.publicKey }
  const payload = encodeForSigning(transaction, definitions)
  const signature = sign(payload, keypair.privateKey)
  if (!verify(payload, signature, keypair.publicKey)) throw new Error('Wallet signature verification failed')
  const signedTransaction = encode({ ...transaction, TxnSignature: signature }, definitions)
  await client.authorize({ intentId: intent.id, grant: intent.grant, signedTransaction })
  return report(await client.waitForIntent(intent.id, { onUpdate: current => console.log(`Status: ${current.state}`) }))
}

function report(intent) {
  const submission = intent.submissions?.at(-1)
  console.log(JSON.stringify({ intentId: intent.id, state: intent.state, transactionHash: submission?.transactionHash, ledgerIndex: submission?.ledgerIndex }, null, 2))
  if (intent.state !== 'validated') process.exitCode = 1
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'The example could not complete')
  process.exitCode = 1
})
