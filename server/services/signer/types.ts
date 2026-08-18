export type XrplTransaction = Record<string, unknown> & { TransactionType: string, Account: string, Fee: string }

export interface SponsorProtocolAdapter {
  readonly name: string
  readonly supportsSponsor: boolean
  prepare(input: { transaction: XrplTransaction, sponsorAddress: string }): Promise<{ signingPayloadHex: string, signingHash: string }>
  attach(input: { transaction: XrplTransaction, publicKey: string, signature: string }): Promise<{ signedBlob: string, transactionHash: string, transaction: XrplTransaction }>
}

export interface SponsorSigner {
  readonly provider: 'local' | 'kms' | 'custodian'
  getIdentity(): Promise<{ address: string, publicKey: string, keyReference: string, networks: string[] }>
  signTransaction(input: {
    network: string
    intentId: string
    canonicalTransaction: XrplTransaction
    expectedSignerAddress: string
    expectedFeeDrops: bigint
  }): Promise<{ signedBlob: string, txHash: string, transaction: XrplTransaction, signingHash: string, signerAddress: string, keyReference: string }>
}
