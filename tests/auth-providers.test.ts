import { memoryAdapter } from '@better-auth/memory-adapter'
import { betterAuth } from 'better-auth'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  COMPANY_SSO_PROVIDER_ID,
  DEFAULT_COMPANY_SSO_LABEL,
  createAuthProviderOptions,
  getPublicAuthProviderConfiguration,
  isValidOidcDiscoveryUrl,
  resolveAuthProviders
} from '../lib/auth-providers'

const google = {
  ACME_GOOGLE_CLIENT_ID: 'google-client-id',
  ACME_GOOGLE_CLIENT_SECRET: 'google-client-secret'
}

const github = {
  ACME_GITHUB_CLIENT_ID: 'github-client-id',
  ACME_GITHUB_CLIENT_SECRET: 'github-client-secret'
}

const sso = {
  ACME_SSO_DISCOVERY_URL: 'https://idp.example.com/.well-known/openid-configuration',
  ACME_SSO_CLIENT_ID: 'sso-client-id',
  ACME_SSO_CLIENT_SECRET: 'sso-client-secret',
  ACME_SSO_LABEL: 'Acme Workforce'
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('authentication provider configuration', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('enables only complete provider credential pairs', () => {
    expect(getPublicAuthProviderConfiguration({
      ACME_GOOGLE_CLIENT_ID: google.ACME_GOOGLE_CLIENT_ID,
      ACME_GITHUB_CLIENT_SECRET: github.ACME_GITHUB_CLIENT_SECRET,
      ACME_SSO_DISCOVERY_URL: sso.ACME_SSO_DISCOVERY_URL,
      ACME_SSO_CLIENT_ID: sso.ACME_SSO_CLIENT_ID
    })).toEqual({ socialProviders: [], sso: null })

    expect(getPublicAuthProviderConfiguration({ ...google, ...github })).toEqual({
      socialProviders: ['google', 'github'],
      sso: null
    })
  })

  it('keeps provider credentials out of the public configuration', () => {
    const publicConfig = getPublicAuthProviderConfiguration({ ...google, ...github, ...sso })

    expect(publicConfig).toEqual({
      socialProviders: ['google', 'github'],
      sso: { providerId: COMPANY_SSO_PROVIDER_ID, label: 'Acme Workforce' }
    })
    expect(JSON.stringify(publicConfig)).not.toContain('client-id')
    expect(JSON.stringify(publicConfig)).not.toContain('client-secret')
    expect(resolveAuthProviders({ ...google, ...github, ...sso })).toMatchObject({
      google: {
        clientId: google.ACME_GOOGLE_CLIENT_ID,
        clientSecret: google.ACME_GOOGLE_CLIENT_SECRET
      },
      github: {
        clientId: github.ACME_GITHUB_CLIENT_ID,
        clientSecret: github.ACME_GITHUB_CLIENT_SECRET
      },
      sso: {
        providerId: COMPANY_SSO_PROVIDER_ID,
        discoveryUrl: sso.ACME_SSO_DISCOVERY_URL,
        clientId: sso.ACME_SSO_CLIENT_ID,
        clientSecret: sso.ACME_SSO_CLIENT_SECRET
      }
    })
  })

  it('uses the default SSO label and rejects unsafe discovery URLs', () => {
    expect(getPublicAuthProviderConfiguration({
      ACME_SSO_DISCOVERY_URL: 'http://idp.example.com/.well-known/openid-configuration',
      ACME_SSO_CLIENT_ID: sso.ACME_SSO_CLIENT_ID,
      ACME_SSO_CLIENT_SECRET: sso.ACME_SSO_CLIENT_SECRET
    })).toEqual({ socialProviders: [], sso: null })
    expect(isValidOidcDiscoveryUrl('https://idp.example.com/config')).toBe(true)
    expect(isValidOidcDiscoveryUrl('http://idp.example.com/config')).toBe(false)
    expect(isValidOidcDiscoveryUrl('https://user:password@idp.example.com/config')).toBe(false)
    expect(isValidOidcDiscoveryUrl('http://127.0.0.1:8080/config', {
      NODE_ENV: 'test',
      ACME_SSO_ALLOW_INSECURE_HTTP: 'true'
    })).toBe(true)
    expect(getPublicAuthProviderConfiguration({
      ...sso,
      ACME_SSO_LABEL: '   '
    })).toEqual({
      socialProviders: [],
      sso: { providerId: COMPANY_SSO_PROVIDER_ID, label: DEFAULT_COMPANY_SSO_LABEL }
    })
  })

  it('requires verified OIDC identity tokens and PKCE', () => {
    const options = createAuthProviderOptions(sso)
    expect(options.plugins).toHaveLength(1)
    expect(options.plugins[0].options).toEqual({
      config: [{
        providerId: COMPANY_SSO_PROVIDER_ID,
        name: 'Acme Workforce',
        discoveryUrl: sso.ACME_SSO_DISCOVERY_URL,
        clientId: sso.ACME_SSO_CLIENT_ID,
        clientSecret: sso.ACME_SSO_CLIENT_SECRET,
        scopes: ['openid', 'profile', 'email'],
        pkce: true,
        requireIdTokenVerification: true,
        disableProviderLogout: true
      }]
    })
    expect(JSON.stringify(options.publicConfig)).not.toContain(sso.ACME_SSO_CLIENT_SECRET)
  })
})

describe('configured social authorization flows', () => {
  it.each([
    ['google', 'accounts.google.com'],
    ['github', 'github.com']
  ])('starts %s sign-in and rejects external return URLs', async (provider, hostname) => {
    const options = createAuthProviderOptions({ ...google, ...github })
    const auth = betterAuth({
      database: memoryAdapter({}),
      secret: 'social-flow-test-secret-long-enough-123456789',
      baseURL: 'https://app.example.com',
      socialProviders: options.socialProviders,
      advanced: { disableOriginCheck: false, disableCSRFCheck: false },
      logger: { disabled: true }
    })
    const request = (callbackURL: string) => auth.handler(new Request('https://app.example.com/api/auth/sign-in/social', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'origin': 'https://app.example.com' },
      body: JSON.stringify({ provider, callbackURL, disableRedirect: true })
    }))
    const response = await request('/app')
    expect(response.status).toBe(200)
    const body = await response.json()
    const url = new URL(body.url)
    expect(url.hostname).toBe(hostname)
    expect(url.searchParams.get('redirect_uri')).toBe(`https://app.example.com/api/auth/callback/${provider}`)
    expect(url.searchParams.get('state')).toBeTruthy()
    expect(body.url).not.toContain('client-secret')
    expect((await request('https://attacker.example/')).status).toBe(403)
  })
})

describe('configured SSO authorization flow', () => {
  it('generates state, PKCE, and the fixed callback without contacting the IdP', async () => {
    const fetchImplementation = vi.fn(async () => new Response(JSON.stringify({
      issuer: 'https://idp.example.com',
      authorization_endpoint: 'https://idp.example.com/oauth2/authorize',
      token_endpoint: 'https://idp.example.com/oauth2/token',
      userinfo_endpoint: 'https://idp.example.com/oauth2/userinfo',
      jwks_uri: 'https://idp.example.com/oauth2/jwks',
      id_token_signing_alg_values_supported: ['RS256']
    }), {
      headers: { 'content-type': 'application/json' }
    }))
    vi.stubGlobal('fetch', fetchImplementation)

    const providerOptions = createAuthProviderOptions({
      ...sso,
      NODE_ENV: 'test'
    })
    const auth = betterAuth({
      database: memoryAdapter({}),
      secret: 'test-auth-secret-that-is-long-enough-123456789',
      baseURL: 'https://app.example.com',
      plugins: providerOptions.plugins,
      account: {
        encryptOAuthTokens: true,
        accountLinking: { disableImplicitLinking: true }
      }
    })

    const response = await auth.handler(new Request('https://app.example.com/api/auth/sign-in/social', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'origin': 'https://app.example.com'
      },
      body: JSON.stringify({
        provider: COMPANY_SSO_PROVIDER_ID,
        callbackURL: '/app',
        disableRedirect: true
      })
    }))
    const body = await response.json() as { redirect: boolean, url: string }
    const authorizationUrl = new URL(body.url)

    expect(response.status).toBe(200)
    expect(body.redirect).toBe(false)
    expect(authorizationUrl.origin).toBe('https://idp.example.com')
    expect(authorizationUrl.pathname).toBe('/oauth2/authorize')
    expect(authorizationUrl.searchParams.get('redirect_uri')).toBe('https://app.example.com/api/auth/callback/company-sso')
    expect(authorizationUrl.searchParams.get('state')).toBeTruthy()
    expect(authorizationUrl.searchParams.get('code_challenge')).toBeTruthy()
    expect(authorizationUrl.searchParams.get('code_challenge_method')).toBe('S256')
    expect(authorizationUrl.searchParams.get('scope')?.split(' ')).toEqual(['openid', 'profile', 'email'])
    expect(fetchImplementation).toHaveBeenCalledOnce()
    expect(String(fetchImplementation.mock.calls[0]?.[0])).toBe(sso.ACME_SSO_DISCOVERY_URL)
    const discoveryRequest = fetchImplementation.mock.calls[0]?.[1] as Request | undefined
    expect(discoveryRequest?.method).toBe('GET')
  })
})
