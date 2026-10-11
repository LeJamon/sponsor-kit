import { genericOAuth } from 'better-auth/plugins/generic-oauth'

export const COMPANY_SSO_PROVIDER_ID = 'company-sso' as const
export const DEFAULT_COMPANY_SSO_LABEL = 'Company SSO'

export type SocialProviderId = 'google' | 'github'

export type AuthEnvironment = Readonly<Record<string, string | undefined>>

type ClientCredentials = {
  clientId: string
  clientSecret: string
}

export type ResolvedAuthProviders = {
  google?: ClientCredentials
  github?: ClientCredentials
  sso?: ClientCredentials & {
    providerId: typeof COMPANY_SSO_PROVIDER_ID
    discoveryUrl: string
    label: string
  }
}

export type PublicAuthProviderConfiguration = {
  socialProviders: SocialProviderId[]
  sso: {
    providerId: typeof COMPANY_SSO_PROVIDER_ID
    label: string
  } | null
}

type BuiltInSocialProviders = {
  google?: ClientCredentials
  github?: ClientCredentials
}

function readEnvironmentValue(environment: AuthEnvironment, name: string) {
  const value = environment[name]
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

function isLoopbackHostname(hostname: string) {
  const normalized = hostname.toLowerCase()
  return normalized === 'localhost'
    || normalized === '127.0.0.1'
    || normalized === '[::1]'
    || normalized === '::1'
}

function allowsInsecureLoopback(environment: AuthEnvironment) {
  const nodeEnvironment = readEnvironmentValue(environment, 'NODE_ENV')
  return (nodeEnvironment === 'development' || nodeEnvironment === 'test')
    && readEnvironmentValue(environment, 'ACME_SSO_ALLOW_INSECURE_HTTP') === 'true'
}

/**
 * Discovery metadata is fetched by Better Auth, so reject unsafe endpoints
 * before the provider is registered. HTTP is available only for explicit
 * loopback development/test configuration.
 */
export function isValidOidcDiscoveryUrl(value: string, environment: AuthEnvironment = process.env) {
  try {
    const url = new URL(value)
    if (url.username || url.password || url.hash) return false
    if (url.protocol === 'https:') return true
    return url.protocol === 'http:'
      && isLoopbackHostname(url.hostname)
      && allowsInsecureLoopback(environment)
  } catch {
    return false
  }
}

export function resolveAuthProviders(environment: AuthEnvironment = process.env): ResolvedAuthProviders {
  const googleClientId = readEnvironmentValue(environment, 'ACME_GOOGLE_CLIENT_ID')
  const googleClientSecret = readEnvironmentValue(environment, 'ACME_GOOGLE_CLIENT_SECRET')
  const githubClientId = readEnvironmentValue(environment, 'ACME_GITHUB_CLIENT_ID')
  const githubClientSecret = readEnvironmentValue(environment, 'ACME_GITHUB_CLIENT_SECRET')
  const discoveryUrl = readEnvironmentValue(environment, 'ACME_SSO_DISCOVERY_URL')
  const ssoClientId = readEnvironmentValue(environment, 'ACME_SSO_CLIENT_ID')
  const ssoClientSecret = readEnvironmentValue(environment, 'ACME_SSO_CLIENT_SECRET')

  const providers: ResolvedAuthProviders = {}
  if (googleClientId && googleClientSecret) {
    providers.google = { clientId: googleClientId, clientSecret: googleClientSecret }
  }
  if (githubClientId && githubClientSecret) {
    providers.github = { clientId: githubClientId, clientSecret: githubClientSecret }
  }

  if (
    discoveryUrl
    && ssoClientId
    && ssoClientSecret
    && isValidOidcDiscoveryUrl(discoveryUrl, environment)
  ) {
    providers.sso = {
      providerId: COMPANY_SSO_PROVIDER_ID,
      label: readEnvironmentValue(environment, 'ACME_SSO_LABEL') || DEFAULT_COMPANY_SSO_LABEL,
      discoveryUrl,
      clientId: ssoClientId,
      clientSecret: ssoClientSecret
    }
  }

  return providers
}

export function getPublicAuthProviderConfiguration(environment: AuthEnvironment = process.env): PublicAuthProviderConfiguration {
  const providers = resolveAuthProviders(environment)
  const socialProviders: SocialProviderId[] = []
  if (providers.google) socialProviders.push('google')
  if (providers.github) socialProviders.push('github')

  return {
    socialProviders,
    sso: providers.sso
      ? { providerId: providers.sso.providerId, label: providers.sso.label }
      : null
  }
}

export function createAuthProviderOptions(environment: AuthEnvironment = process.env) {
  const providers = resolveAuthProviders(environment)
  const socialProviders: BuiltInSocialProviders = {}
  if (providers.google) socialProviders.google = providers.google
  if (providers.github) socialProviders.github = providers.github

  const plugins = providers.sso
    ? [genericOAuth({
        config: [{
          providerId: providers.sso.providerId,
          name: providers.sso.label,
          discoveryUrl: providers.sso.discoveryUrl,
          clientId: providers.sso.clientId,
          clientSecret: providers.sso.clientSecret,
          scopes: ['openid', 'profile', 'email'],
          pkce: true,
          requireIdTokenVerification: true,
          disableProviderLogout: true
        }]
      })]
    : []

  return {
    socialProviders,
    plugins,
    publicConfig: getPublicAuthProviderConfiguration(environment)
  }
}
