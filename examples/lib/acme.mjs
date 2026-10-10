const terminalStates = new Set(['validated', 'failed', 'rejected', 'expired', 'cancelled', 'superseded'])

/** Server-side client. Never bundle this module with an API key into a browser. */
export function createAcmeClient({ baseUrl, projectId, apiKey, fetchImpl = fetch }) {
  const url = new URL(baseUrl)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
    throw new Error('Use HTTPS, or HTTP on localhost for development')
  }
  if (!projectId || !apiKey || url.username || url.password || url.search || url.hash) throw new Error('Provide the app URL, project ID, and server-side API key')
  const base = url.href.replace(/\/$/, '')
  const projectPath = `/api/v1/projects/${encodeURIComponent(projectId)}`

  async function request(path, { method = 'GET', body, idempotencyKey, authenticate = true, signal } = {}) {
    const response = await fetchImpl(`${base}${path}`, {
      method,
      headers: {
        ...(authenticate ? { Authorization: `Bearer ${apiKey}` } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      redirect: 'error',
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000)
    })
    if (!response.ok) {
      // Do not print arbitrary server responses containing signing artifacts.
      const error = new Error(`ACME request failed (${response.status})`)
      error.status = response.status
      throw error
    }
    return response.json()
  }

  return {
    protocol: () => request(`${projectPath}/protocol`),
    createPayment: ({ account, destination, amountDrops = '1', operationId }) => {
      if (!operationId) throw new Error('A stable operationId is required')
      if (!/^[1-9]\d*$/.test(amountDrops)) throw new Error('amountDrops must be a positive integer string')
      return request(`${projectPath}/intents`, {
        method: 'POST', idempotencyKey: operationId,
        body: { account, transaction: { TransactionType: 'Payment', Destination: destination, Amount: amountDrops }, sponsorship: { fee: true, reserve: false }, signing: { mode: 'single', signerCount: 1 } }
      })
    },
    authorize: ({ intentId, grant, signedTransaction }) => request(`/api/v1/intents/${encodeURIComponent(intentId)}/authorize`, {
      method: 'POST', authenticate: false, body: { grant, signedTransaction }
    }),
    getIntent: intentId => request(`/api/v1/intents/${encodeURIComponent(intentId)}`),
    async waitForIntent(intentId, { timeoutMs = 180_000, signal, onUpdate = () => {} } = {}) {
      const deadline = Date.now() + timeoutMs
      let delay = 500
      while (Date.now() < deadline) {
        signal?.throwIfAborted()
        const timeout = AbortSignal.timeout(Math.max(1, deadline - Date.now()))
        const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout
        const intent = await request(`/api/v1/intents/${encodeURIComponent(intentId)}`, { signal: requestSignal })
        onUpdate(intent)
        if (terminalStates.has(intent.state)) return intent
        await new Promise(resolve => setTimeout(resolve, Math.min(delay, Math.max(0, deadline - Date.now()))))
        delay = Math.min(delay * 2, 5_000)
      }
      throw new Error(`Confirmation timed out. Resume polling intent ${intentId}; do not create a replacement automatically.`)
    }
  }
}
