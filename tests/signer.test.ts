import { Buffer } from 'node:buffer'
import { deriveAddress, deriveKeypair, generateSeed } from 'ripple-keypairs'
import { describe, expect, it } from 'vitest'
import { LocalSponsorSigner } from '../server/services/signer/local'
import type { SponsorProtocolAdapter } from '../server/services/signer/types'

function fixture() {
  const seed = generateSeed()
  const address = deriveAddress(deriveKeypair(seed).publicKey)
  const adapter: SponsorProtocolAdapter = {
    name: 'test', supportsSponsor: true,
    async prepare() { return { signingPayloadHex: Buffer.from('canonical sponsor payload').toString('hex'), signingHash: 'SIGNING123' } },
    async attach(input) {
      return {
        signedBlob: Buffer.from(JSON.stringify(input)).toString('hex'),
        transactionHash: 'ABC123',
        transaction: { ...input.transaction, SponsorSignature: { SigningPubKey: input.publicKey, TxnSignature: input.signature } }
      }
    }
  }
  return { seed, address, adapter }
}

describe('LocalSponsorSigner', () => {
  it('checks the identity, network, fee and sponsor before signing', async () => {
    const { seed, address, adapter } = fixture()
    const signer = new LocalSponsorSigner({ seed, expectedAddress: address, keyReference: 'local-v1', allowedNetworks: ['testnet'], allowMainnet: false, adapter })
    const result = await signer.signTransaction({ network: 'testnet', intentId: 'intent-1', canonicalTransaction: { TransactionType: 'Payment', Account: 'rUser', Fee: '12', Sponsor: address }, expectedSignerAddress: address, expectedFeeDrops: 12n })
    expect(result.signerAddress).toBe(address)
    expect(result.txHash).toBe('ABC123')
    await expect(signer.signTransaction({ network: 'mainnet', intentId: 'intent-1', canonicalTransaction: { TransactionType: 'Payment', Account: 'rUser', Fee: '12', Sponsor: address }, expectedSignerAddress: address, expectedFeeDrops: 12n })).rejects.toThrow('SIGNER_NETWORK_NOT_ALLOWED')
  })

  it('fails closed when configured address does not match the seed', () => {
    const { seed, adapter } = fixture()
    expect(() => new LocalSponsorSigner({ seed, expectedAddress: 'rWrong', keyReference: 'local-v1', allowedNetworks: ['testnet'], allowMainnet: false, adapter })).toThrow('does not match')
  })
})
