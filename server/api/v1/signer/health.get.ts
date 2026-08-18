import { deriveAddress, deriveKeypair } from 'ripple-keypairs'

export default defineEventHandler(() => {
  const seed = process.env.ACME_LOCAL_SPONSOR_SEED
  const expectedAddress = process.env.ACME_LOCAL_SPONSOR_ADDRESS
  const signingAvailable = (() => {
    try {
      return Boolean(seed && expectedAddress && deriveAddress(deriveKeypair(seed).publicKey) === expectedAddress)
    } catch {
      return false
    }
  })()
  return {
    status: signingAvailable ? 'operational' : 'unavailable',
    provider: 'local',
    keyReference: signingAvailable ? 'local-v1' : null,
    secretExposed: false,
    mainnetEnabled: signingAvailable && process.env.ACME_ALLOW_LOCAL_SIGNER_ON_MAINNET === 'true',
    signingAvailable,
    reason: signingAvailable ? undefined : 'Local signer seed and address are missing or inconsistent.'
  }
})
