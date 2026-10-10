import { isValidClassicAddress } from 'ripple-address-codec'
import { z } from 'zod'

export const xrplAccountSchema = z.string().refine(isValidClassicAddress, 'Enter a valid XRPL classic address')

export const intentRequestSchema = z.object({
  account: xrplAccountSchema,
  transaction: z.record(z.string(), z.unknown()),
  sponsorship: z.object({ fee: z.boolean().default(true), reserve: z.boolean().default(false) }),
  policyId: z.uuid().optional(),
  signing: z.object({ mode: z.enum(['single', 'multi']).default('single'), signerCount: z.number().int().min(1).max(32).default(1) }).default({ mode: 'single', signerCount: 1 })
}).superRefine((value, context) => {
  if (!value.sponsorship.fee && !value.sponsorship.reserve) context.addIssue({ code: 'custom', message: 'At least one sponsorship type is required', path: ['sponsorship'] })
  if (value.signing.mode === 'single' && value.signing.signerCount !== 1) context.addIssue({ code: 'custom', message: 'Single signing has exactly one signer', path: ['signing', 'signerCount'] })
})
