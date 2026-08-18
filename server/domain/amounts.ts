export function xrpToDrops(value: string | number): bigint {
  const normalized = String(value)
  if (!/^\d+(\.\d{1,6})?$/.test(normalized)) throw new Error(`Invalid XRP amount: ${normalized}`)
  const [whole, fraction = ''] = normalized.split('.')
  return BigInt(whole!) * BigInt(1_000_000) + BigInt(fraction.padEnd(6, '0'))
}
