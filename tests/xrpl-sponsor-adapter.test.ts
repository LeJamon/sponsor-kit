import { createHash } from 'node:crypto'
import { DEFAULT_DEFINITIONS, decode, encodeForSigning, encodeForSigningSponsor } from 'ripple-binary-codec'
import { deriveAddress, deriveKeypair, generateSeed, sign, verify } from 'ripple-keypairs'
import { describe, expect, it } from 'vitest'
import { XrplSponsorAdapter } from '../server/services/signer/xrpl-adapter'
import type { XrplTransaction } from '../server/services/signer/types'
import { DEVNET_DEFINITIONS_HASH, SPONSOR_AMENDMENT_ID } from '../server/services/xrpl/definitions'

function sha512Half(hex: string) {
  return createHash('sha512').update(Buffer.from(hex, 'hex')).digest('hex').slice(0, 64).toUpperCase()
}

function fixture() {
  const sponsee = deriveKeypair(generateSeed())
  const sponsor = deriveKeypair(generateSeed())
  const transaction = {
    TransactionType: 'Payment',
    Account: deriveAddress(sponsee.publicKey),
    Destination: deriveAddress(sponsor.publicKey),
    Amount: '1',
    Fee: '12',
    Sequence: 1,
    LastLedgerSequence: 100,
    NetworkID: 2,
    Sponsor: deriveAddress(sponsor.publicKey),
    SponsorFlags: 1,
    SigningPubKey: sponsee.publicKey
  } as XrplTransaction
  transaction.TxnSignature = sign(encodeForSigning(transaction, DEFAULT_DEFINITIONS), sponsee.privateKey)
  const adapter = new XrplSponsorAdapter({
    amendmentId: SPONSOR_AMENDMENT_ID,
    definitions: DEFAULT_DEFINITIONS,
    definitionsHash: DEVNET_DEFINITIONS_HASH,
    networkId: 2,
    serverVersion: 'test',
    transactionTypes: ['Payment'],
    flags: { sponsorFee: 1, sponsorReserve: 2, transferEnd: 65536, transferCreate: 131072, transferReassign: 262144, sponsorCreatedAccount: 524288 }
  })
  return { adapter, sponsor, transaction }
}

describe('XrplSponsorAdapter', () => {
  it('adds a valid sponsor signature without changing either signing payload', async () => {
    const { adapter, sponsor, transaction } = fixture()
    const prepared = await adapter.prepare({ transaction, sponsorAddress: String(transaction.Sponsor) })
    const sponsorSignature = sign(prepared.signingPayloadHex, sponsor.privateKey)
    const attached = await adapter.attach({ transaction, publicKey: sponsor.publicKey, signature: sponsorSignature })

    expect(verify(prepared.signingPayloadHex, sponsorSignature, sponsor.publicKey)).toBe(true)
    expect(encodeForSigningSponsor(attached.transaction, DEFAULT_DEFINITIONS)).toBe(prepared.signingPayloadHex)
    expect(encodeForSigning(attached.transaction, DEFAULT_DEFINITIONS)).toBe(encodeForSigning(transaction, DEFAULT_DEFINITIONS))
    expect(adapter.decode(attached.signedBlob)).toEqual(attached.transaction)
    expect(decode(attached.signedBlob, DEFAULT_DEFINITIONS)).toEqual(attached.transaction)
    expect(attached.transactionHash).toBe(sha512Half(`54584E00${attached.signedBlob}`))
  })

  it('rejects a transaction changed after the sponsee signed it', async () => {
    const { adapter, transaction } = fixture()
    const mutated = { ...transaction, Fee: '13' }
    await expect(adapter.prepare({ transaction: mutated, sponsorAddress: String(transaction.Sponsor) })).rejects.toThrow('ADAPTER_SPONSEE_SIGNATURE_INVALID')
  })

  it('rejects duplicate sponsor signatures', async () => {
    const { adapter, sponsor, transaction } = fixture()
    await expect(adapter.attach({ transaction: { ...transaction, SponsorSignature: {} }, publicKey: sponsor.publicKey, signature: '00' })).rejects.toThrow('ADAPTER_SPONSOR_SIGNATURE_ALREADY_PRESENT')
  })
})
