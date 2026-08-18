const explorerOrigins = {
  mainnet: 'https://livenet.xrpl.org',
  testnet: 'https://testnet.xrpl.org',
  devnet: 'https://devnet.xrpl.org'
} as const

export function transactionExplorerUrl(network: string, transactionHash: string | null | undefined): string | undefined {
  const origin = explorerOrigins[network as keyof typeof explorerOrigins]
  if (!origin || !transactionHash || !/^[A-F0-9]{64}$/i.test(transactionHash)) return undefined
  return `${origin}/transactions/${transactionHash.toUpperCase()}`
}
