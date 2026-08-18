export class XrplRpcError extends Error {
  constructor(message: string, readonly method: string, readonly code?: string, readonly httpStatus?: number, readonly data?: Record<string, unknown>) {
    super(message)
    this.name = 'XrplRpcError'
  }
}

function retryDelay(attempt: number): Promise<void> {
  const exponential = Math.min(1_500, 100 * 2 ** attempt)
  const jitter = Math.floor(Math.random() * 100)
  return new Promise(resolve => setTimeout(resolve, exponential + jitter))
}

export async function xrplRpc<T>(rpcUrl: string, method: string, params: Record<string, unknown>, options: { retries?: number, timeoutMs?: number } = {}): Promise<T> {
  const retries = options.retries ?? (method === 'submit' ? 0 : 2)
  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ method, params: [params] }),
        signal: AbortSignal.timeout(options.timeoutMs ?? 8_000)
      })
      if (!response.ok) {
        const retryable = response.status === 429 || response.status >= 500
        if (retryable && attempt < retries) {
          await retryDelay(attempt)
          continue
        }
        throw new XrplRpcError('XRPL RPC unavailable', method, undefined, response.status)
      }
      const payload = await response.json() as { result?: T & { error?: string, error_message?: string } }
      if (!payload.result) throw new XrplRpcError('XRPL RPC returned an invalid response', method)
      if (payload.result.error) throw new XrplRpcError(payload.result.error_message || 'XRPL RPC rejected the request', method, payload.result.error, undefined, payload.result as Record<string, unknown>)
      return payload.result
    } catch (error) {
      lastError = error
      const retryable = !(error instanceof XrplRpcError) || error.httpStatus === 429 || (error.httpStatus !== undefined && error.httpStatus >= 500)
      if (!retryable || attempt === retries) break
      await retryDelay(attempt)
    }
  }
  if (lastError instanceof XrplRpcError) throw lastError
  throw new XrplRpcError(lastError instanceof Error ? lastError.message : 'XRPL RPC unavailable', method)
}

export async function fetchAllAccountObjects(rpcUrl: string, account: string, ledgerIndex: 'validated' | number) {
  const objects: Array<Record<string, unknown>> = []
  let marker: unknown
  let resolvedLedger = ledgerIndex
  do {
    const page = await xrplRpc<{ account_objects: Array<Record<string, unknown>>, ledger_index: number, marker?: unknown }>(rpcUrl, 'account_objects', {
      account,
      ledger_index: resolvedLedger,
      limit: 400,
      ...(marker === undefined ? {} : { marker })
    })
    objects.push(...page.account_objects)
    resolvedLedger = page.ledger_index
    marker = page.marker
  } while (marker !== undefined)
  return { objects, ledgerIndex: Number(resolvedLedger) }
}
