type PasswordResetEnvironment = Record<string, string | undefined>

type PasswordResetUser = {
  email?: string
  name?: string | null
}

export type PasswordResetMessage = {
  user: PasswordResetUser
  url: string
  token: string
}

type PasswordResetTransport = {
  provider: 'http' | 'resend'
  endpoint: string
  secret: string
  from: string
}

type FetchLike = typeof fetch

const DEFAULT_RESEND_ENDPOINT = 'https://api.resend.com/emails'
const PASSWORD_RESET_SUBJECT = 'Reset your ACME password'

function trimEnvironmentValue(environment: PasswordResetEnvironment, name: string) {
  const value = environment[name]?.trim()
  return value || undefined
}

function isSupportedProvider(value: string | undefined): value is 'http' | 'resend' | 'disabled' {
  return value === 'http' || value === 'resend' || value === 'disabled'
}

function resolveProvider(environment: PasswordResetEnvironment) {
  const configured = trimEnvironmentValue(environment, 'ACME_PASSWORD_RESET_EMAIL_PROVIDER')
  if (configured && isSupportedProvider(configured)) return configured
  if (configured) return 'disabled'
  if (trimEnvironmentValue(environment, 'ACME_PASSWORD_RESET_EMAIL_URL')) return 'http'
  if (trimEnvironmentValue(environment, 'ACME_PASSWORD_RESET_RESEND_API_KEY')) return 'resend'
  return 'disabled'
}

function isValidEmailEndpoint(value: string, environment: PasswordResetEnvironment) {
  try {
    const url = new URL(value)
    if (url.username || url.password || url.search || url.hash) return false
    if (url.protocol === 'https:') return true
    if (url.protocol !== 'http:') return false
    const loopback = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname.toLowerCase())
    return loopback && allowsInsecureLoopback(environment)
  } catch {
    return false
  }
}

function allowsInsecureLoopback(environment: PasswordResetEnvironment) {
  return trimEnvironmentValue(environment, 'ACME_PASSWORD_RESET_ALLOW_INSECURE_HTTP') === 'true'
    && trimEnvironmentValue(environment, 'NODE_ENV') !== 'production'
}

export function resolvePasswordResetTransport(environment: PasswordResetEnvironment = process.env): PasswordResetTransport | undefined {
  const provider = resolveProvider(environment)
  if (provider === 'disabled') return undefined

  const from = trimEnvironmentValue(environment, 'ACME_PASSWORD_RESET_EMAIL_FROM')
  if (!from) return undefined

  if (provider === 'resend') {
    const secret = trimEnvironmentValue(environment, 'ACME_PASSWORD_RESET_RESEND_API_KEY')
    if (!secret) return undefined
    return { provider, endpoint: DEFAULT_RESEND_ENDPOINT, secret, from }
  }

  const endpoint = trimEnvironmentValue(environment, 'ACME_PASSWORD_RESET_EMAIL_URL')
  const secret = trimEnvironmentValue(environment, 'ACME_PASSWORD_RESET_EMAIL_SECRET')
  if (!endpoint || !secret || !isValidEmailEndpoint(endpoint, environment)) return undefined
  return { provider, endpoint, secret, from }
}

export function isPasswordResetEnabled(environment: PasswordResetEnvironment = process.env) {
  return resolvePasswordResetTransport(environment) !== undefined
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    [String.fromCharCode(39)]: '&#39;'
  })[character] || character)
}

function createMessage(message: PasswordResetMessage) {
  const safeUrl = escapeHtml(message.url)
  const greeting = message.user.name ? `Hi ${escapeHtml(message.user.name)},` : 'Hi,'
  return {
    subject: PASSWORD_RESET_SUBJECT,
    text: `${greeting}\n\nReset your ACME password by opening this link:\n${message.url}\n\nThis link expires soon and can only be used once. If you did not request this, you can ignore this email.`,
    html: `<p>${greeting}</p><p>Reset your ACME password by clicking the link below:</p><p><a href="${safeUrl}">Reset password</a></p><p>This link expires soon and can only be used once. If you did not request this, you can ignore this email.</p>`
  }
}

async function deliver(
  transport: PasswordResetTransport,
  message: PasswordResetMessage,
  fetchImplementation: FetchLike
) {
  if (!message.user.email) throw new Error('Password reset email delivery failed')
  const content = createMessage(message)
  const body = JSON.stringify({
    from: transport.from,
    to: [message.user.email],
    subject: content.subject,
    text: content.text,
    html: content.html
  })

  try {
    const response = await fetchImplementation(transport.endpoint, {
      method: 'POST',
      redirect: 'error',
      headers: {
        'Authorization': `Bearer ${transport.secret}`,
        'Content-Type': 'application/json'
      },
      body,
      signal: AbortSignal.timeout(10_000)
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
  } catch {
    throw new Error('Password reset email delivery failed')
  }
}

export function createPasswordResetSender(
  environment: PasswordResetEnvironment = process.env,
  fetchImplementation: FetchLike = fetch
) {
  const transport = resolvePasswordResetTransport(environment)
  if (!transport) return undefined

  return async (message: PasswordResetMessage) => {
    await deliver(transport, message, fetchImplementation)
  }
}
