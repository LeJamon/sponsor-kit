import { encodeForSigning, encodeForSigningSponsor } from 'ripple-binary-codec'
import { deriveAddress, deriveKeypair, generateSeed, sign, verify } from 'ripple-keypairs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearSponsorDefinitionsCache, loadSponsorProtocolDefinitions, SPONSOR_AMENDMENT_ID, SPONSOR_PREFIX_AMENDMENT_ID } from '../server/services/xrpl/definitions'
import { XrplSponsorAdapter } from '../server/services/signer/xrpl-adapter'
import definitions from './fixtures/devnet-definitions.json'

afterEach(() => {
  clearSponsorDefinitionsCache()
  vi.unstubAllGlobals()
})

function mockNetwork(networkId = 2, prefixEnabled = true) {
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    const { method } = JSON.parse(String(init.body))
    const result = method === 'server_definitions'
      ? definitions
      : method === 'feature'
        ? { features: { [SPONSOR_AMENDMENT_ID]: { name: 'Sponsor', enabled: true, supported: true }, [SPONSOR_PREFIX_AMENDMENT_ID]: { name: 'fixCleanup3_4_0', enabled: prefixEnabled, supported: true } } }
        : { info: { network_id: networkId, build_version: '3.4.1-fixture' } }
    return Response.json({ result })
  }))
}

describe('captured Devnet signing protocol', () => {
  it('preserves the wallet signature when attaching a sponsor signature using current wire definitions', async () => {
    mockNetwork()
    const protocol = await loadSponsorProtocolDefinitions({ rpcUrl: 'https://fixture.invalid', allowedHashes: [definitions.hash] })
    const wallet = deriveKeypair(generateSeed({ algorithm: 'ed25519' }))
    const sponsor = deriveKeypair(generateSeed({ algorithm: 'ed25519' }))
    const unsigned = {
      TransactionType: 'Payment', Account: deriveAddress(wallet.publicKey), Destination: deriveAddress(sponsor.publicKey),
      Amount: '1', Fee: '10', Sequence: 1, LastLedgerSequence: 100,
      Sponsor: deriveAddress(sponsor.publicKey), SponsorFlags: 1, SigningPubKey: wallet.publicKey
    }
    const payload = encodeForSigning(unsigned, protocol.definitions)
    const transaction = { ...unsigned, TxnSignature: sign(payload, wallet.privateKey) }
    const adapter = new XrplSponsorAdapter(protocol)
    const prepared = await adapter.prepare({ transaction, sponsorAddress: unsigned.Sponsor })
    const attached = await adapter.attach({ transaction, publicKey: sponsor.publicKey, signature: sign(prepared.signingPayloadHex, sponsor.privateKey) })
    const decoded = adapter.decode(attached.signedBlob)
    expect(decoded.TxnSignature).toBe(transaction.TxnSignature)
    expect(verify(encodeForSigning(decoded, protocol.definitions), transaction.TxnSignature, wallet.publicKey)).toBe(true)
    const sponsorSignature = decoded.SponsorSignature as { TxnSignature: string }
    expect(prepared.signingPayloadHex.startsWith('53504E00')).toBe(true)
    expect(verify(encodeForSigningSponsor(decoded, protocol.definitions), sponsorSignature.TxnSignature, sponsor.publicKey)).toBe(true)
    expect(verify(encodeForSigning(decoded, protocol.definitions), sponsorSignature.TxnSignature, sponsor.publicKey)).toBe(false)
  })

  it('rejects a network without role-specific sponsor signatures', async () => {
    mockNetwork(2, false)
    await expect(loadSponsorProtocolDefinitions({ rpcUrl: 'https://fixture.invalid', allowedHashes: [definitions.hash] })).rejects.toThrow('XRPL_SPONSOR_SIGNING_PREFIX_NOT_ENABLED')
  })

  it('fails closed for an unreviewed definition set', async () => {
    mockNetwork()
    await expect(loadSponsorProtocolDefinitions({ rpcUrl: 'https://fixture.invalid', allowedHashes: ['0'.repeat(64)] })).rejects.toThrow('XRPL_DEFINITIONS_HASH_NOT_ALLOWED')
  })

  it('rejects a non-Devnet endpoint even when definitions match', async () => {
    mockNetwork(0)
    await expect(loadSponsorProtocolDefinitions({ rpcUrl: 'https://fixture.invalid', allowedHashes: [definitions.hash] })).rejects.toThrow('XRPL_NETWORK_ID_MISMATCH')
  })
})
