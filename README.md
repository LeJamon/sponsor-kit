# ACME Sponsor Kit

ACME is a wallet-agnostic sponsorship control plane for XRPL applications. It prepares policy-bound intents, coordinates wallet and sponsor signatures, tracks fee spend and reserve exposure separately, and only records success after validated ledger confirmation.

The name and sail mark are temporary product placeholders.

## Product boundary

- `xrpl-connect` remains the free, open-source wallet integration.
- This repository is the independently deployable API, developer console, and operator console.
- End-wallet users never need an ACME account and ACME never handles their private keys.
- The sponsor key is behind the `SponsorSigner` interface. The initial deployment includes a backend-only local signer; KMS and custodian implementations can replace it without changing intent or policy services.
- XLS-68 is capability-gated. Unsupported networks fail before signing or reserving capital.

## Existing wallets

Fee sponsorship and reserve sponsorship are independent. An existing wallet can use fee sponsorship for eligible future transactions without migrating its current objects.

Existing reserves require explicit migration:

1. Inspect the account and its owner objects at a validated ledger.
2. Classify each target as eligible, already sponsored, unsupported, or changed.
3. Prepare one `SponsorshipTransfer` per eligible account/object reserve.
4. Have the wallet owner sign the exact canonical transaction.
5. ACME verifies and co-signs it, then reconciles the resulting sponsor from a validated ledger.

Sponsoring an `AccountRoot` does not retroactively sponsor its trustlines, offers, tickets, NFTs, or other objects. Trustlines are side-specific (`HighSponsor`/`LowSponsor`) and remain disabled until the configured protocol adapter has explicit tests for them.

## Local development

Requirements: Node.js 22+, npm 11+, and Docker for PostgreSQL.

```bash
cp .env.example .env
npm install
npm run db:setup
npm run dev
```

`db:setup` starts the local PostgreSQL service, waits until it is healthy, and
applies the baseline schema, then idempotently creates the local platform
administrator:

```text
Email:    admin@acme.local
Password: AcmeLocalAdmin!2026
```

These known credentials are accepted only when `db:setup` explicitly enables
local defaults, `DATABASE_URL` points to localhost, and `NODE_ENV` is not
`production`. Set `ACME_BOOTSTRAP_ADMIN_EMAIL`,
`ACME_BOOTSTRAP_ADMIN_PASSWORD`, and optionally
`ACME_BOOTSTRAP_ADMIN_NAME` to bootstrap any non-local environment. Use a
unique secret of at least 16 characters.

Use `npm run db:generate` only after changing
`server/database/schema.ts`; generating a migration does not apply it. During
greenfield development, reset the disposable local volume and regenerate the
baseline instead of accumulating compatibility migrations.

There is no demo data path. The console reads PostgreSQL, network state comes from the configured XRPL endpoint, and submitted transactions are reconciled against validated ledgers.

## Local signer

Set `ACME_LOCAL_SPONSOR_SEED` and its derived `ACME_LOCAL_SPONSOR_ADDRESS` only in the server environment. They must never use the `NUXT_PUBLIC_` prefix, be saved in PostgreSQL, or be logged.

The local signer:

- derives and verifies its configured address at startup;
- is restricted to configured networks;
- blocks mainnet unless `ACME_ALLOW_LOCAL_SIGNER_ON_MAINNET=true`;
- independently checks network, signer address, sponsor field, fee, payload, and transaction hash;
- returns health and key-reference metadata without key material.

The signer loads `server_definitions`, verifies the Sponsor amendment by name and ID, and accepts only explicitly allowlisted definition hashes. The sponsee signs first. ACME decodes that exact blob, verifies its ledger-authorized signature, attaches `SponsorSignature`, stores the final bytes, and only then allows the outbox worker to submit them.

The embedded worker is convenient for a single Node deployment. Set `ACME_EMBEDDED_WORKER=false` and run `npm run worker` as a separately supervised process when the API is horizontally scaled.

## Docker deployment

Build the production image from the repository root:

```bash
docker build -t acme-sponsor-kit .
```

The multi-stage image builds with Node.js 24 and runs Nuxt's standalone Node
server as a non-root user. Only `.output` is copied into the runtime image;
local environment files are excluded from the build context. Supply database,
authentication, and signer settings at runtime:

```bash
docker run --rm --name acme-sponsor-kit -p 3000:3000 \
  --env-file /path/to/deployment.env acme-sponsor-kit
```

Use the variables in `.env.example` to prepare the deployment environment.
`DATABASE_URL` must point to a database reachable from the container;
`localhost` inside the container refers to the container itself. Set
`NUXT_PUBLIC_APP_URL` to the public HTTPS URL when hosted, and provide unique
`BETTER_AUTH_SECRET` and `ACME_GRANT_SECRET` values plus a funded Devnet sponsor
account. Never pass secrets as Docker build arguments.

If you override `ACME_XRPL_RPC_URL`, also set `NUXT_XRPL_RPC_URL` to the same
endpoint so the public network statistics use the runtime override too.

For Northflank, build the root `Dockerfile`, expose HTTP port `3000`, and inject
the variables as runtime secrets/settings. Keep one application instance with
`ACME_EMBEDDED_WORKER=true` so the API and transaction worker run together.
`HOST` defaults to `0.0.0.0` and `PORT` to `3000`; both can be overridden at
runtime. Northflank terminates HTTPS in front of the container.

Apply migrations and bootstrap the administrator before starting the app,
using a separate checkout or job with the development dependencies installed.
With the target environment variables already set, these commands do not
require a local `.env` file:

```bash
node ./node_modules/drizzle-kit/bin.cjs migrate
node --import tsx scripts/bootstrap-admin.ts
```

The bootstrap requires `ACME_BOOTSTRAP_ADMIN_EMAIL` and
`ACME_BOOTSTRAP_ADMIN_PASSWORD` (at least 16 characters) for a hosted database.
The runtime image does not include migration tooling or automatically modify
the database schema.
After deployment, check `/api/v1/health` for database, signer, XRPL, and worker
health. This endpoint checks external dependencies and should not be used as
a container liveness probe.

## Commands

```bash
npm run dev          # local server
npm run worker       # separately supervised outbox/reconciliation worker
npm run smoke:devnet # opt-in real sponsored fee + reserve transfer smoke
npm run lint         # ESLint
npm run typecheck    # Nuxt/Vue TypeScript
npm test             # domain and signer contract tests
npm run build        # production bundle
npm run verify       # all checks above
npm run db:setup     # start local PostgreSQL and apply migrations
npm run db:generate  # generate SQL after a schema change
npm run db:migrate   # apply committed migrations to DATABASE_URL
npm run admin:bootstrap # create or promote the configured platform admin
```

## API preview

Create an API key in the developer console, then create a real sponsorship intent:

```bash
curl -X POST http://localhost:3000/api/v1/projects/$PROJECT_ID/intents \
  -H "Authorization: Bearer $ACME_API_KEY" \
  -H 'Idempotency-Key: checkout-42' \
  -H 'Content-Type: application/json' \
  -d '{
    "account": "rN7n7otQDd6FczFgLdlqtyMVrn3HMfXpf",
    "transaction": {
      "TransactionType": "Payment",
      "Destination": "rfkDkFai4jUfCvAJiZ5Vm7XvvWjYvDqeYo",
      "Amount": "1000000"
    },
    "sponsorship": { "fee": true, "reserve": false }
  }'
```

The response contains the complete canonical transaction and a short-lived, single-use grant. The wallet signs the transaction first without submitting it, then sends its hexadecimal signed blob and the grant to `POST /api/v1/intents/:intentId/authorize`. ACME persists the final sponsor-signed blob before asynchronous submission. Poll `GET /api/v1/intents/:intentId`; only `validated` means a successful validated XRPL outcome. A validated non-`tesSUCCESS` result is ledger-final but reported as `failed`.

Every intent-creation request uses a server-side, scoped API key and an `Idempotency-Key`. Unrestricted API keys never belong in frontend code. Existing wallets use the authenticated reserve-migration console, which pins an inspection ledger and prepares one `SponsorshipTransfer` at a time.

See the [direct integration and API guide](docs/integration.md) for the complete
wallet-signing lifecycle, endpoint contracts, error handling, finality, and the
future `xrpl-connect` adapter boundary. See [architecture.md](docs/architecture.md)
for the service trust boundaries and state design.
