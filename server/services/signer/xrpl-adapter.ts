import { createHash } from 'node:crypto'
import { decode, encode, encodeForMultisigning, encodeForSigning, encodeForSigningSponsor } from 'ripple-binary-codec'
import { deriveAddress, verify } from 'ripple-keypairs'
import type { SponsorProtocolDefinitions } from '../xrpl/definitions'
import type { SponsorProtocolAdapter, XrplTransaction } from './types'

function sha512HalfHex(hex: string): string {
  return createHash('sha512').update(Buffer.from(hex, 'hex')).digest('hex').slice(0, 64).toUpperCase()
}

export class XrplSponsorAdapter implements SponsorProtocolAdapter {
  readonly supportsSponsor = true
  readonly name: string

  constructor(private readonly protocol: SponsorProtocolDefinitions) {
    this.name = `xrpl:${protocol.definitionsHash}`
  }

  async prepare(input: { transaction: XrplTransaction, sponsorAddress: string }) {
    if (input.transaction.Sponsor !== input.sponsorAddress) throw new Error('ADAPTER_SPONSOR_MISMATCH')
    const sponsorFlags = Number(input.transaction.SponsorFlags)
    if (!Number.isInteger(sponsorFlags) || sponsorFlags <= 0 || (sponsorFlags & ~3) !== 0) {
      throw new Error('ADAPTER_SPONSOR_FLAGS_INVALID')
    }
    this.verifySponseeSignatures(input.transaction)
    const signingPayloadHex = encodeForSigningSponsor(input.transaction, this.protocol.definitions)
    return { signingPayloadHex, signingHash: sha512HalfHex(signingPayloadHex) }
  }

  async attach(input: { transaction: XrplTransaction, publicKey: string, signature: string }) {
    if (input.transaction.SponsorSignature) throw new Error('ADAPTER_SPONSOR_SIGNATURE_ALREADY_PRESENT')
    if (deriveAddress(input.publicKey) !== input.transaction.Sponsor) throw new Error('ADAPTER_PUBLIC_KEY_MISMATCH')
    const signingPayloadHex = encodeForSigningSponsor(input.transaction, this.protocol.definitions)
    if (!verify(signingPayloadHex, input.signature, input.publicKey)) throw new Error('ADAPTER_SIGNATURE_INVALID')
    const transaction = {
      ...input.transaction,
      SponsorSignature: {
        SigningPubKey: input.publicKey,
        TxnSignature: input.signature
      }
    } as XrplTransaction
    const signedBlob = encode(transaction, this.protocol.definitions)
    return { signedBlob, transactionHash: sha512HalfHex(`54584E00${signedBlob}`), transaction }
  }

  decode(blob: string): XrplTransaction {
    return decode(blob, this.protocol.definitions) as XrplTransaction
  }

  private verifySponseeSignatures(transaction: XrplTransaction) {
    const signingPubKey = transaction.SigningPubKey
    const transactionSignature = transaction.TxnSignature
    const signers = transaction.Signers
    if (typeof signingPubKey === 'string' && signingPubKey.length > 0 && typeof transactionSignature === 'string') {
      if (Array.isArray(signers)) throw new Error('ADAPTER_SPONSEE_SIGNATURE_FIELDS_INVALID')
      const payload = encodeForSigning(transaction, this.protocol.definitions)
      if (!verify(payload, transactionSignature, signingPubKey)) throw new Error('ADAPTER_SPONSEE_SIGNATURE_INVALID')
      return
    }
    if (signingPubKey === '' && Array.isArray(signers) && !transactionSignature) {
      if (!signers.length) throw new Error('ADAPTER_SPONSEE_SIGNERS_EMPTY')
      for (const entry of signers) {
        const signer = (entry as { Signer?: Record<string, unknown> }).Signer
        const account = signer?.Account
        const publicKey = signer?.SigningPubKey
        const signature = signer?.TxnSignature
        if (typeof account !== 'string' || typeof publicKey !== 'string' || typeof signature !== 'string') {
          throw new Error('ADAPTER_SPONSEE_SIGNER_INVALID')
        }
        const payload = encodeForMultisigning(transaction, account, this.protocol.definitions)
        if (!verify(payload, signature, publicKey)) throw new Error('ADAPTER_SPONSEE_SIGNATURE_INVALID')
      }
      return
    }
    throw new Error('ADAPTER_SPONSEE_SIGNATURE_REQUIRED')
  }
}
