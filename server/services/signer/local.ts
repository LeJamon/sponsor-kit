import { deriveAddress, deriveKeypair, sign } from 'ripple-keypairs'
import type { SponsorProtocolAdapter, SponsorSigner, XrplTransaction } from './types'

export class LocalSponsorSigner implements SponsorSigner {
  readonly provider = 'local' as const
  private readonly keypair: ReturnType<typeof deriveKeypair>
  private readonly address: string

  constructor(private readonly options: {
    seed: string
    expectedAddress: string
    keyReference: string
    allowedNetworks: string[]
    allowMainnet: boolean
    adapter: SponsorProtocolAdapter
  }) {
    this.keypair = deriveKeypair(options.seed)
    this.address = deriveAddress(this.keypair.publicKey)
    if (this.address !== options.expectedAddress) throw new Error('Configured local sponsor seed does not match ACME_LOCAL_SPONSOR_ADDRESS')
    if (options.allowedNetworks.includes('mainnet') && !options.allowMainnet) throw new Error('Local signer is blocked on mainnet unless explicitly enabled')
  }

  async getIdentity() {
    return { address: this.address, publicKey: this.keypair.publicKey, keyReference: this.options.keyReference, networks: [...this.options.allowedNetworks] }
  }

  async signTransaction(input: { network: string, intentId: string, canonicalTransaction: XrplTransaction, expectedSignerAddress: string, expectedFeeDrops: bigint }) {
    if (!this.options.allowedNetworks.includes(input.network)) throw new Error('SIGNER_NETWORK_NOT_ALLOWED')
    if (input.expectedSignerAddress !== this.address) throw new Error('SIGNER_ADDRESS_MISMATCH')
    if (BigInt(input.canonicalTransaction.Fee) !== input.expectedFeeDrops) throw new Error('SIGNER_FEE_MISMATCH')
    if (input.canonicalTransaction.Sponsor !== this.address) throw new Error('SIGNER_SPONSOR_MISMATCH')
    if (!input.intentId) throw new Error('SIGNER_INTENT_REQUIRED')
    const prepared = await this.options.adapter.prepare({ transaction: input.canonicalTransaction, sponsorAddress: this.address })
    if (!/^[A-Fa-f0-9]+$/.test(prepared.signingPayloadHex) || prepared.signingPayloadHex.length % 2) throw new Error('INVALID_SPONSOR_SIGNING_PAYLOAD')
    const signature = sign(prepared.signingPayloadHex, this.keypair.privateKey)
    const attached = await this.options.adapter.attach({ transaction: input.canonicalTransaction, publicKey: this.keypair.publicKey, signature })
    const preparedAfterAttach = await this.options.adapter.prepare({ transaction: attached.transaction, sponsorAddress: this.address })
    if (preparedAfterAttach.signingHash !== prepared.signingHash) throw new Error('SIGNER_TRANSACTION_MUTATED')
    return { signedBlob: attached.signedBlob, txHash: attached.transactionHash, transaction: attached.transaction, signingHash: prepared.signingHash, signerAddress: this.address, keyReference: this.options.keyReference }
  }
}
