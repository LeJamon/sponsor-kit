import { loadSponsorProtocolDefinitions } from './xrpl/definitions'

export type SponsorCapabilities = {
  feeSponsorship: boolean
  reserveSponsorship: boolean
  accountCreationSponsorship: boolean
  existingAccountSponsorship: boolean
  existingObjectSponsorship: boolean
  sponsorshipSet: boolean
  sponsorshipTransfer: boolean
  trustlineSideSponsorship: boolean
  batchSponsorship: boolean
  reason?: string
}

export async function discoverSponsorCapabilities(input: { rpcUrl: string, adapterSupportsSponsor: boolean, allowedDefinitionsHashes?: string[] }): Promise<SponsorCapabilities> {
  const unavailable: SponsorCapabilities = {
    feeSponsorship: false, reserveSponsorship: false, accountCreationSponsorship: false,
    existingAccountSponsorship: false, existingObjectSponsorship: false, sponsorshipSet: false,
    sponsorshipTransfer: false, trustlineSideSponsorship: false, batchSponsorship: false
  }
  if (!input.adapterSupportsSponsor) return { ...unavailable, reason: 'The configured protocol adapter does not support Sponsor serialization.' }
  try {
    await loadSponsorProtocolDefinitions({ rpcUrl: input.rpcUrl, allowedHashes: input.allowedDefinitionsHashes })
    return {
      feeSponsorship: true, reserveSponsorship: true, accountCreationSponsorship: true,
      existingAccountSponsorship: true, existingObjectSponsorship: true, sponsorshipSet: true,
      sponsorshipTransfer: true, trustlineSideSponsorship: true, batchSponsorship: false
    }
  } catch (error) {
    return { ...unavailable, reason: error instanceof Error ? error.message : 'XRPL capability discovery failed.' }
  }
}
