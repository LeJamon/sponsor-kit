import { defineConfig, devices } from '@playwright/test'

const port = 3100
const baseURL = `http://127.0.0.1:${port}`
const environment = {
  NODE_ENV: 'production',
  HOST: '127.0.0.1',
  PORT: String(port),
  NUXT_PUBLIC_APP_URL: baseURL,
  NUXT_PUBLIC_DEFAULT_NETWORK: 'devnet',
  ACME_XRPL_RPC_URL: 'http://127.0.0.1:5199',
  NUXT_XRPL_RPC_URL: 'http://127.0.0.1:5199',
  ACME_XRPL_DEFINITIONS_HASHES: '1EA05B0FC11101F7C500BD0DAC794A8BC746A7FBA6250B75489603EB820E0FF5',
  ACME_LOCAL_SPONSOR_SEED: 'snoPBrXtMeMyMHUVTgbuqAfg1SUTb',
  ACME_LOCAL_SPONSOR_ADDRESS: 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh',
  ACME_EMBEDDED_WORKER: 'true',
  ACME_PASSWORD_RESET_EMAIL_PROVIDER: 'disabled',
  BETTER_AUTH_SECRET: 'e2e-only-authentication-secret-do-not-use-for-deployment',
  ACME_GRANT_SECRET: 'e2e-only-grant-secret-do-not-use-for-deployment'
}

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  use: { baseURL, ...devices['Desktop Chrome'], trace: 'retain-on-failure' },
  webServer: [
    { command: 'node tests/fixtures/xrpl-server.mjs', url: 'http://127.0.0.1:5199', reuseExistingServer: false },
    { command: 'node .output/server/index.mjs', url: `${baseURL}/api/auth/config`, env: environment, reuseExistingServer: false, timeout: 60_000 }
  ]
})
