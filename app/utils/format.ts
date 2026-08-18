export function formatDropsAsXrp(drops: string | undefined | null) {
  if (drops == null) return '—'
  const value = BigInt(drops)
  const whole = value / 1_000_000n
  const fraction = (value % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '')
  return `${whole.toLocaleString()}${fraction ? `.${fraction}` : ''} XRP`
}

export function formatDateTime(value: string | Date | undefined | null) {
  return value ? new Date(value).toLocaleString() : '—'
}

export function shortenAddress(value: string | undefined | null) {
  return value ? `${value.slice(0, 8)}…${value.slice(-6)}` : '—'
}
