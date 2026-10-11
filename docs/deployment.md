# Devnet deployment

ACME runs as a stateless Nuxt API and console backed by PostgreSQL. The runtime
image contains only the generated Nuxt server and runs as the unprivileged
`node` user. Database migrations and administrator bootstrap use the separate
`tools` image so an application rollout never changes the schema implicitly.

## Build the images

Run both builds from the repository root. Build arguments are not used for
secrets; all deployment settings are supplied when a container starts.

```bash
docker build --target runtime -t acme-sponsor-kit:devnet .
docker build --target tools -t acme-sponsor-kit-tools:devnet .
```

The runtime image listens on `0.0.0.0:3000` and can be checked at
`GET /api/v1/live`. That endpoint only proves that the Node process is serving
requests. Use `GET /api/v1/health` for dependency status; it checks PostgreSQL,
the configured XRPL endpoint, the signer, and the embedded worker and returns a
meaningful JSON body with HTTP 503 when a dependency is degraded.

## Provision runtime settings

Create a secret set in the deployment platform. At minimum, configure:

```text
NUXT_PUBLIC_APP_URL=https://your-public-host.example
NUXT_PUBLIC_DEFAULT_NETWORK=devnet
DATABASE_URL=postgres://...
BETTER_AUTH_SECRET=<unique random secret, at least 32 bytes>
ACME_GRANT_SECRET=<different unique random secret, at least 32 bytes>
ACME_XRPL_RPC_URL=https://s.devnet.rippletest.net:51234/
ACME_XRPL_DEFINITIONS_HASHES=<allowlisted server_definitions hash>
ACME_EMBEDDED_WORKER=true
ACME_LOCAL_SPONSOR_SEED=<funded devnet seed>
ACME_LOCAL_SPONSOR_ADDRESS=<address derived from that seed>
ACME_ALLOW_LOCAL_SIGNER_ON_MAINNET=false
```

Keep the sponsor seed, authentication secrets, grant secret, and email
provider secret server-only. They are read from the runtime environment and
are not required during `docker build`. `ACME_XRPL_RPC_URL` is read at request
time by the public network endpoint, so changing it does not require baking a
new image.

### Social login and company SSO

Social login providers are configured at runtime. Set both values in each pair
to enable Google or GitHub; an incomplete pair leaves that provider disabled
without affecting password login:

```text
ACME_GOOGLE_CLIENT_ID=...
ACME_GOOGLE_CLIENT_SECRET=...
ACME_GITHUB_CLIENT_ID=...
ACME_GITHUB_CLIENT_SECRET=...
```

Register these exact callback URLs in the provider dashboards, using the
origin from `NUXT_PUBLIC_APP_URL`:

```text
https://your-public-host.example/api/auth/callback/google
https://your-public-host.example/api/auth/callback/github
```

For company login, ACME accepts OIDC discovery metadata (SAML is not
supported). Set all three values to enable the fixed `company-sso` provider;
`ACME_SSO_LABEL` is optional and defaults to `Company SSO`:

```text
ACME_SSO_DISCOVERY_URL=https://idp.example.com/.well-known/openid-configuration
ACME_SSO_CLIENT_ID=...
ACME_SSO_CLIENT_SECRET=...
ACME_SSO_LABEL=Company SSO
```

Register this callback URL with the identity provider:

```text
https://your-public-host.example/api/auth/callback/company-sso
```

The discovery URL must use HTTPS. HTTP is accepted only for an explicitly
enabled development/test loopback endpoint with
`ACME_SSO_ALLOW_INSECURE_HTTP=true`; do not enable that setting in production.
The OIDC flow requests `openid profile email`, uses PKCE, and requires a
verified ID token. Provider logout is disabled so the application's existing
logout flow remains authoritative. Better Auth OAuth tokens are encrypted with
`BETTER_AUTH_SECRET`; keep that secret stable when rotating or redeploying so
existing linked sessions and tokens remain usable. Runtime credentials are
never included in the public auth configuration response, and enabling these
providers requires no database migration.

An existing password account with the same email is not implicitly linked to a
social or SSO account. Existing users should continue with their original
sign-in method; this login page does not provide account linking or silently
merge identities. Provider sign-in may create a new local user
when no matching account exists; company domain or token claims do not assign
organizations or roles, because normal onboarding remains responsible for
that decision.

Password reset delivery is disabled unless a sender and one complete provider
configuration are present. For a generic HTTP mail service set
`ACME_PASSWORD_RESET_EMAIL_PROVIDER=http`,
`ACME_PASSWORD_RESET_EMAIL_URL`, `ACME_PASSWORD_RESET_EMAIL_SECRET`, and
`ACME_PASSWORD_RESET_EMAIL_FROM`. For Resend set
`ACME_PASSWORD_RESET_EMAIL_PROVIDER=resend`,
`ACME_PASSWORD_RESET_RESEND_API_KEY`, and
`ACME_PASSWORD_RESET_EMAIL_FROM`. The sender should be a verified address.
External mail endpoints must use HTTPS and cannot include URL credentials or
query strings. For local testing only, a loopback HTTP endpoint can be enabled
with `ACME_PASSWORD_RESET_ALLOW_INSECURE_HTTP=true` outside production.

## Migrate before rollout

Take a database backup before a production migration. Run the tools image with
the same `DATABASE_URL` that the runtime will use. No `.env` file is required;
the npm scripts use a local `.env` only when one exists.

```bash
docker run --rm --env-file deployment.env \
  acme-sponsor-kit-tools:devnet \
  ./node_modules/drizzle-kit/bin.cjs migrate

docker run --rm --env-file deployment.env \
  acme-sponsor-kit-tools:devnet \
  --import tsx scripts/bootstrap-admin.ts
```

For a hosted database, provide the bootstrap values in `deployment.env`:
`ACME_BOOTSTRAP_ADMIN_EMAIL`, `ACME_BOOTSTRAP_ADMIN_PASSWORD` (at least 16
characters), and optional `ACME_BOOTSTRAP_ADMIN_NAME`. The bootstrap is
idempotent: an existing account is promoted to administrator after its
credential account is verified. Never use the local default credentials in a
hosted environment. Run the migration command again as a smoke check; applying
the committed migrations repeatedly is safe and non-destructive.

After the migration and bootstrap succeed, roll out the runtime image. Wait
for `/api/v1/live` before routing traffic, then verify `/api/v1/health` and
watch the worker heartbeat. Keep one embedded worker while using the local
signer. When running several API replicas, set `ACME_EMBEDDED_WORKER=false` on those
replicas and run the worker from the `tools` target with
`node --import tsx scripts/worker.ts` and the same database and XRPL settings.

## Northflank runbook

Create a service from the repository `Dockerfile`, set the target to
`runtime`, expose HTTP port `3000`, and configure the liveness probe as
`GET /api/v1/live`. Inject the values above as Northflank secrets or runtime
variables. Set the health probe to `/api/v1/health` only when the platform can
handle its intentional 503 response during dependency incidents.

Run the `tools` target as a one-off job against the same private network and
database before each rollout. The order is: backup, migrate, bootstrap or
verify the administrator, deploy the runtime, then verify liveness and
dependency health. Do not put database credentials or sponsor keys in the
image, repository, or build logs.

## Backup, restore, and worker monitoring

Keep automated PostgreSQL backups and test restores into a disposable database
at least once per release. A restore drill should use a fresh database, restore
a representative backup, run the migration command, and verify the health
endpoint and an authenticated sign-in before the backup is considered usable.
Never run `pg_restore --clean` against the production database as part of a
routine test.

Monitor the `worker_heartbeats` row for `xrpl-intent-worker` and alert when it
is missing, not `running`, or older than 30 seconds. Monitor the
`outbox_events` table for rows where `dead_lettered_at` is set, and alert on
increasing `attempts`, stale locks, and non-null `last_error`. Dead-lettered
submission events require an operator to inspect the XRPL result and intent
before recovery. The admin console lists failed jobs and offers an audited
requeue with a reason and version check. Recovery retries the stored transaction
bytes; it does not sign a replacement or release reserved funding. Do not delete
those rows to clear an alert. Keep logs redacted and never log reset tokens, authorization headers,
signing material, or provider secrets.

## Dependency checks

Run both `npm audit` and `npm audit --omit=dev` when updating dependencies.
The production-only audit does not describe code bundled by Nuxt, so inspect
the generated `.output` artifact as well. The MVP review found remaining
upstream advisories in the build/development toolchain. The corresponding
`simple-git`, `@simple-git/argv-parser`, `node-forge`, `js-yaml`, `braces`,
`brace-expansion`, and `postcss-selector-parser` directories in the reviewed
server artifact contained package metadata but no executable files, and the
generated server chunks did not import them. No audit suppression or targeted
package removal is used. Recheck this after framework or tooling updates;
image scanners may still report the copied package metadata.
