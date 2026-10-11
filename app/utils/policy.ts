import { isValidClassicAddress } from 'ripple-address-codec'

export type PolicyForm = {
  maximumFeeXrp: string
  maximumReserveXrp: string
  maximumIntentsPerWalletPerDay: string
  intentTtlSeconds: string
  transactionTypes: string[]
  allowedDestinations: string
  allowedFields: string
}

export type PolicyDocument = {
  allowedTransactionTypes: string[]
  allowedDestinations: string[]
  allowedFields: string[]
  maximumFeeDrops: string
  maximumReserveDrops: string
  maximumIntentsPerWalletPerDay: number
  intentTtlSeconds: number
  requireWalletProof: true
}

const DROPS_PER_XRP = 1_000_000n

/** Convert a base-10 XRP amount to drops without using floating point math. */
export function xrpToDrops(value: string): string {
  const normalized = value.trim()
  if (!/^\d+(?:\.\d{1,6})?$/.test(normalized)) {
    throw new Error('Enter an XRP amount with up to six decimal places.')
  }
  const [whole = '0', fraction = ''] = normalized.split('.')
  return (BigInt(whole) * DROPS_PER_XRP + BigInt(fraction.padEnd(6, '0') || '0')).toString()
}

/** Format drops for an editable XRP input without losing precision. */
export function dropsToXrp(drops: unknown, fallback = '0'): string {
  if (typeof drops !== 'string' && typeof drops !== 'number' && typeof drops !== 'bigint') return fallback
  try {
    const value = BigInt(drops)
    if (value < 0n) return fallback
    const whole = value / DROPS_PER_XRP
    const fraction = (value % DROPS_PER_XRP).toString().padStart(6, '0').replace(/0+$/, '')
    return fraction ? `${whole}.${fraction}` : whole.toString()
  } catch {
    return fallback
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function lines(value: string): string[] {
  return [...new Set(value.split(/[\n,]/).map(item => item.trim()).filter(Boolean))]
}

export function invalidClassicDestinations(value: string): string[] {
  return lines(value).filter(destination => !isValidClassicAddress(destination))
}

export function policyFormFromDocument(document: Record<string, unknown>): PolicyForm {
  const transactionTypes = stringArray(document.allowedTransactionTypes)
  return {
    maximumFeeXrp: dropsToXrp(document.maximumFeeDrops, '0.01'),
    maximumReserveXrp: dropsToXrp(document.maximumReserveDrops, '1'),
    maximumIntentsPerWalletPerDay: String(typeof document.maximumIntentsPerWalletPerDay === 'number' ? document.maximumIntentsPerWalletPerDay : 100),
    intentTtlSeconds: String(typeof document.intentTtlSeconds === 'number' ? document.intentTtlSeconds : 300),
    transactionTypes,
    allowedDestinations: stringArray(document.allowedDestinations).join('\n'),
    allowedFields: stringArray(document.allowedFields).join('\n')
  }
}

export function emptyPolicyForm(transactionTypes: string[] = []): PolicyForm {
  return {
    maximumFeeXrp: '0.01',
    maximumReserveXrp: '1',
    maximumIntentsPerWalletPerDay: '100',
    intentTtlSeconds: '300',
    transactionTypes: [...transactionTypes],
    allowedDestinations: '',
    allowedFields: ''
  }
}

export function policyDocumentFromForm(form: PolicyForm): PolicyDocument {
  const maximumIntentsPerWalletPerDay = Number(form.maximumIntentsPerWalletPerDay)
  const intentTtlSeconds = Number(form.intentTtlSeconds)
  if (!Number.isInteger(maximumIntentsPerWalletPerDay) || maximumIntentsPerWalletPerDay < 1) {
    throw new Error('Daily wallet intents must be a positive whole number.')
  }
  if (!Number.isInteger(intentTtlSeconds) || intentTtlSeconds < 30 || intentTtlSeconds > 900) {
    throw new Error('Intent TTL must be a whole number between 30 and 900 seconds.')
  }
  const allowedTransactionTypes = [...new Set(form.transactionTypes.map(item => item.trim()).filter(Boolean))]
  if (!allowedTransactionTypes.length) throw new Error('Select at least one transaction type.')
  const invalidDestinations = invalidClassicDestinations(form.allowedDestinations)
  if (invalidDestinations.length) throw new Error(`These destinations are not valid classic XRPL addresses: ${invalidDestinations.join(', ')}`)
  return {
    allowedTransactionTypes,
    allowedDestinations: lines(form.allowedDestinations),
    allowedFields: lines(form.allowedFields),
    maximumFeeDrops: xrpToDrops(form.maximumFeeXrp),
    maximumReserveDrops: xrpToDrops(form.maximumReserveXrp),
    maximumIntentsPerWalletPerDay,
    intentTtlSeconds,
    requireWalletProof: true
  }
}
