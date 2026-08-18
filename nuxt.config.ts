// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: [
    '@nuxt/eslint',
    '@nuxt/ui'
  ],

  devtools: {
    enabled: process.env.NODE_ENV === 'development'
  },

  css: ['~/assets/css/main.css'],

  runtimeConfig: {
    databaseUrl: process.env.DATABASE_URL,
    betterAuthSecret: process.env.BETTER_AUTH_SECRET,
    localSponsorSeed: process.env.ACME_LOCAL_SPONSOR_SEED,
    localSponsorAddress: process.env.ACME_LOCAL_SPONSOR_ADDRESS,
    xrplRpcUrl: process.env.ACME_XRPL_RPC_URL || 'https://s.devnet.rippletest.net:51234/',
    xrplDefinitionsHashes: process.env.ACME_XRPL_DEFINITIONS_HASHES,
    allowLocalSignerOnMainnet: process.env.ACME_ALLOW_LOCAL_SIGNER_ON_MAINNET === 'true',
    public: {
      appUrl: process.env.NUXT_PUBLIC_APP_URL || 'http://localhost:3000',
      defaultNetwork: process.env.NUXT_PUBLIC_DEFAULT_NETWORK || 'devnet'
    }
  },

  routeRules: {
    '/api/**': { cors: false }
  },

  compatibilityDate: '2026-08-18',

  nitro: {
    esbuild: {
      options: { target: 'es2022' }
    }
  },

  vite: {
    build: { target: 'es2022' }
  },

  eslint: {
    config: {
      stylistic: {
        commaDangle: 'never',
        braceStyle: '1tbs'
      }
    }
  },

  icon: {
    fallbackToApi: false,
    serverBundle: { collections: ['lucide'] },
    clientBundle: { scan: true }
  }
})
