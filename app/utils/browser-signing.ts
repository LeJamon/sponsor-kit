import type { XrplDefinitions } from 'ripple-binary-codec'

/**
 * The only wallet state retained by the console is the public identity. The
 * private key lives in this module closure for the lifetime of the tab and is
 * never returned to a component, persisted, or sent to the server.
 */
export type DisposableWallet = {
  address: string
  publicKey: string
}

export type RawXrplDefinitions = ConstructorParameters<typeof XrplDefinitions>[0]

let wallet: DisposableWallet | null = null
let privateKey: string | null = null

function requireBrowserCrypto(): Crypto {
  if (import.meta.server || typeof globalThis.crypto?.getRandomValues !== 'function') {
    throw new Error('A secure browser random source is required to create a Devnet wallet.')
  }
  return globalThis.crypto
}

/** Create a fresh ed25519 account without exposing its seed to the UI. */
export async function createDisposableWallet(): Promise<DisposableWallet> {
  const { deriveAddress, deriveKeypair, generateSeed } = await import('ripple-keypairs')
  const entropy = requireBrowserCrypto().getRandomValues(new Uint8Array(16))
  const seed = generateSeed({ entropy, algorithm: 'ed25519' })
  const keypair = deriveKeypair(seed, { algorithm: 'ed25519' })

  privateKey = keypair.privateKey
  wallet = {
    address: deriveAddress(keypair.publicKey),
    publicKey: keypair.publicKey
  }
  return { ...wallet }
}

export function getDisposableWallet(): DisposableWallet | null {
  return wallet ? { ...wallet } : null
}

/** Wipe the in-memory key. The Devnet account remains on-ledger but cannot be signed by this tab. */
export function clearDisposableWallet() {
  wallet = null
  privateKey = null
}

export function verifyProtocolDefinitions(input: {
  definitions: RawXrplDefinitions
  definitionsHash: string
  expectedDefinitionsHash: string
}): boolean {
  const expected = input.expectedDefinitionsHash.trim().toUpperCase()
  const responseHash = input.definitionsHash.trim().toUpperCase()
  const rawHash = typeof input.definitions === 'object' && input.definitions !== null && 'hash' in input.definitions
    ? String(input.definitions.hash || '').trim().toUpperCase()
    : ''
  return Boolean(expected && expected === responseHash && responseHash === rawHash)
}

export async function signCanonicalTransaction(input: {
  transaction: Record<string, unknown>
  definitions: RawXrplDefinitions
  expectedDefinitionsHash: string
  protocolDefinitionsHash: string
  account: string
}): Promise<{ signedBlob: string, signingPayload: string, transaction: Record<string, unknown> }> {
  if (!wallet || !privateKey) throw new Error('The disposable wallet is no longer available. Create a new wallet in this tab.')
  if (wallet.address !== input.account) throw new Error('The wallet account does not match the approved transaction.')
  if (input.transaction.Account !== input.account) throw new Error('The approved transaction account does not match the wallet.')
  if (!verifyProtocolDefinitions({
    definitions: input.definitions,
    definitionsHash: input.protocolDefinitionsHash,
    expectedDefinitionsHash: input.expectedDefinitionsHash
  })) {
    throw new Error('The Devnet protocol definitions changed. Refresh the intent before signing.')
  }

  const [{ encode, encodeForSigning, XrplDefinitions }, { sign }] = await Promise.all([
    import('ripple-binary-codec'),
    import('ripple-keypairs')
  ])
  const definitions = new XrplDefinitions(input.definitions)
  // SigningPubKey is part of the exact single-signature payload. Add it before
  // encoding so the signature covers the same envelope the server verifies.
  const transaction = { ...input.transaction, SigningPubKey: wallet.publicKey }
  const signingPayload = encodeForSigning(transaction, definitions)
  const signature = sign(signingPayload, privateKey)
  const signedTransaction = {
    ...transaction,
    TxnSignature: signature
  }

  return {
    signedBlob: encode(signedTransaction, definitions),
    signingPayload,
    transaction: signedTransaction
  }
}
