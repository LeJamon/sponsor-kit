# XRPL test fixtures

`devnet-definitions.json` is the `server_definitions` result retrieved from the
configured public XRPL Devnet endpoint on 2026-10-10. The network reported ID 2,
rippled 3.4.1, and the enabled Sponsor amendment
`BE1F90581635DBCEBFC4678C4B54FEDDC1A17B50FD02CFE765A4132A342126AC`.
Definitions hash:
`1EA05B0FC11101F7C500BD0DAC794A8BC746A7FBA6250B75489603EB820E0FF5`.

`xrpl-server.mjs` is a deterministic **test-only** RPC fixture bound to loopback.
It supplies account/ledger state and records submitted bytes in memory. It never
connects to a real network. The application verifies actual wallet and sponsor
signatures using the captured definitions; the fixture supplies ledger outcomes.
Passing these tests proves the application workflow, not XRPL conformance.
Use the opt-in Devnet smoke separately to verify actual ledger validation.

Sponsor signatures use the role-specific `SPN` prefix and require
`fixCleanup3_4_0`, as specified in [XLS-68 signature prefixes](https://github.com/XRPLF/XRPL-Standards/blob/master/XLS-0068-sponsored-fees-and-reserves/README.md#36122-signature-prefixes).
The loopback RPC verifies both signatures before returning a validated fixture
result. Actual consensus and reserve behavior require the live Devnet smoke.

## Run the complete local checks

Point `DATABASE_URL` to a disposable PostgreSQL database, then run:

```sh
npm run db:migrate
ACME_BOOTSTRAP_ADMIN_EMAIL=test-admin@example.invalid \
ACME_BOOTSTRAP_ADMIN_PASSWORD=local-test-only-password \
BETTER_AUTH_SECRET=local-test-only-auth-secret-long-enough npm run admin:bootstrap
MVP_FUNDING_TEST_DATABASE_URL="$DATABASE_URL" npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Browser tests start their own loopback RPC and application, and intercept only
the faucet request. Authentication, signing, PostgreSQL, authorization, worker
submission, and status APIs execute the production application code. Do not
point the browser suite at a database containing real application data.
