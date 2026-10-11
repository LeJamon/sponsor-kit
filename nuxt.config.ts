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

  ui: {
    colorMode: false
  },

  runtimeConfig: {
    // Private settings are read directly by server code at runtime. Keeping
    // them out of the build-time config prevents deployment secrets from
    // being embedded in the generated Nitro bundle.
    databaseUrl: '',
    betterAuthSecret: '',
    localSponsorSeed: '',
    localSponsorAddress: '',
    xrplRpcUrl: '',
    xrplDefinitionsHashes: '',
    allowLocalSignerOnMainnet: false,
    public: {
      appUrl: '',
      defaultNetwork: 'devnet'
    }
  },

  routeRules: {
    '/api/**': { cors: false }
  },

  experimental: {
    // Nuxt 4.6's generated route fetch types avoid excessive recursion in
    // large API surfaces while retaining typed $fetch for known routes.
    routeTypedFetch: true
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
