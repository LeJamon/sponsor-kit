import { z } from 'zod'

export const policyDocumentSchema = z.object({
  allowedTransactionTypes: z.array(z.string()).min(1),
  allowedDestinations: z.array(z.string()).default([]),
  allowedFields: z.array(z.string()).default([]),
  maximumFeeDrops: z.string().regex(/^\d+$/),
  maximumReserveDrops: z.string().regex(/^\d+$/).default('0'),
  maximumIntentsPerWalletPerDay: z.number().int().positive(),
  intentTtlSeconds: z.number().int().min(30).max(900),
  requireWalletProof: z.boolean().default(true)
})

export type PolicyDocument = z.infer<typeof policyDocumentSchema>

export type PolicyDecision = { allowed: true } | { allowed: false, code: string, reason: string }

const forbiddenClientFields = new Set(['SponsorSignature', 'TxnSignature', 'Signers', 'SigningPubKey'])

export function evaluatePolicy(input: {
  policy: PolicyDocument
  transaction: Record<string, unknown>
  account: string
  feeDrops: bigint
  reserveDrops: bigint
}): PolicyDecision {
  const { policy, transaction, account, feeDrops, reserveDrops } = input
  if (transaction.Account !== account) return { allowed: false, code: 'ACCOUNT_MISMATCH', reason: 'Transaction Account does not match the authenticated wallet.' }
  if (!policy.allowedTransactionTypes.includes(String(transaction.TransactionType))) return { allowed: false, code: 'TRANSACTION_NOT_ALLOWED', reason: 'The transaction type is not allowed by this policy.' }
  for (const field of forbiddenClientFields) if (field in transaction) return { allowed: false, code: 'SIGNING_FIELD_FORBIDDEN', reason: `${field} must be populated by the signing flow.` }
  if (feeDrops > BigInt(policy.maximumFeeDrops)) return { allowed: false, code: 'FEE_LIMIT_EXCEEDED', reason: 'The estimated transaction fee exceeds the policy cap.' }
  if (reserveDrops > BigInt(policy.maximumReserveDrops)) return { allowed: false, code: 'RESERVE_LIMIT_EXCEEDED', reason: 'The reserve exposure exceeds the policy cap.' }
  if (policy.allowedDestinations.length && transaction.Destination && !policy.allowedDestinations.includes(String(transaction.Destination))) return { allowed: false, code: 'DESTINATION_NOT_ALLOWED', reason: 'The transaction destination is not allowed by this policy.' }
  if (policy.allowedFields.length) {
    const universal = new Set(['TransactionType', 'Account', 'Fee', 'Sequence', 'TicketSequence', 'LastLedgerSequence', 'NetworkID'])
    const unexpected = Object.keys(transaction).find(field => !universal.has(field) && !policy.allowedFields.includes(field))
    if (unexpected) return { allowed: false, code: 'FIELD_NOT_ALLOWED', reason: `${unexpected} is not allowed by this policy.` }
  }
  return { allowed: true }
}
