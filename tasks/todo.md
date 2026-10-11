# ACME Sponsor Kit

## Project creation modal and deletion — 2026-10-11

- [x] Replace standalone creation forms with a light modal for project name and Devnet network, including first/last-project flows.
- [x] Add an owner/admin Danger zone with named confirmation and project removal.
- [x] Enforce deletion authorization and lifecycle checks, preserve historical ledger records and shared sponsor capacity, and revoke access.
- [x] Verify creation/retry, deletion/cancel, last-project recovery, authorization, browser layouts, and required checks.

### Review

Added a shared light modal with name and Devnet selection, used from the project dropdown and empty-workspace flows. The overview ends with an owner/admin Danger zone requiring the exact project name. Deletion archives the project and revokes its API keys while retaining transaction history and shared treasury capacity. Pending transactions and active reserve obligations must be resolved first. No schema migration is required.

Lint, typecheck, production build, all 66 unit/API/database tests, and all 8 browser scenarios passed against a disposable local database. Verified creation and deletion after lost responses, modal cancellation, named confirmation, project permissions, last-project replacement in the same organization, and existing login/payment flows. Reviewed desktop and mobile modal screenshots. Updated CI to run deletion integration tests.

## Hover navigation — 2026-10-11

- [x] Inspect the updated faucet sidebar and match its interaction model.
- [x] Replace click-to-collapse with an icon rail that expands on hover/focus; use the boat logo alone.
- [x] Verify hover, pointer exit, keyboard focus, mobile navigation, and build checks.

### Review

Matched the updated faucet interaction: an 80px desktop icon rail expands on hover or keyboard focus, with matching content offset and 260ms transitions. Removed both toggle buttons and the persisted collapsed state; the sidebar header uses the boat alone. Touch desktops retain labels, mobile retains its drawer, and reduced-motion preferences disable transitions.

Lint, typecheck, production build, and the updated dashboard browser regression passed. Verified collapse after clicking a link and moving away, keyboard focus expansion, content offsets, project creation/switching, and mobile navigation. Reviewed settled collapsed/expanded screenshots; screenshots disable animation to avoid capture-time transition artifacts.

## Dashboard navigation and projects — 2026-10-11

- [x] Add authenticated project creation with membership checks and complete sponsor/policy provisioning.
- [x] Add shared project selection across console pages and a project dropdown with creation flow.
- [x] Make desktop navigation collapsible; remove the status box and pilot wording.
- [x] Verify project isolation, creation, switching, responsive navigation, lint, types, and build.

### Review

Implemented persistent sidebar collapse and project selection, with a project dropdown available at desktop and mobile sizes. All console pages now use the selected project, with separate data cache keys and page resets that keep in-flight actions scoped to their original project. Owners/admins can create projects with complete sponsor, policy, snapshot, and budget provisioning; retries are idempotent and existing results remain retrievable during network outages. Removed pilot branding and the status box while retaining factual network identifiers. No schema migration is required.

Verification: lint, typecheck, production build, all 61 unit/API/database tests, and all 7 browser scenarios passed against a disposable local database. Browser coverage includes response-loss retry, remembered selection/collapse, selected-project requests across console pages, API-key isolation, mobile navigation, and existing login/payment/onboarding flows. Desktop/mobile screenshots reviewed. CI now runs the new database integration tests.

## Login copy simplification — 2026-10-11

- [x] Use “Log in to ACME” and remove the requested form and artwork descriptions.
- [x] Verify lint, build, and rendered copy and layout.

### Review

Lint and production build passed. Browser checks confirmed the requested heading and removed copy, artwork on the right, and no mobile overflow. Desktop screenshot reviewed.

## Login visual continuity — 2026-10-11

- [x] Move the login form left and boat right, preserving their proportions and mobile layout.
- [x] Verify production build and desktop/mobile browser composition.

### Review

Moved the form before the artwork in DOM order and mirrored the grid column
proportions. Lint, production build, and Chromium desktop/mobile checks passed.
Screenshot review confirmed the full boat on the right, consistent with the
landing page; mobile keeps the form visible without horizontal overflow.

## Split login and external authentication — 2026-10-11

- [x] Build a responsive light-only login with the existing boat on the left and the form on the right.
- [x] Configure Google/GitHub and company SSO through the existing Better Auth library, with explicit provider readiness and safe callbacks.
- [x] Document provider registration, runtime credentials, callback URLs, and any SSO scope decisions.
- [x] Verify authentication configuration, failure paths, lint/typecheck/build, and desktop/mobile browser rendering.

### Review

Implemented a dedicated split login layout, accessible password visibility,
Google/GitHub provider actions, and configurable company OIDC sign-in. Provider
buttons appear only for complete runtime configuration. Existing email login
is preserved, new provider users go to setup, automatic identity merging is
disabled, and provider tokens are encrypted. SAML and multi-organization IdP
registration are not part of this OIDC implementation. No database migration
is needed.

Verification passed lint, typecheck, production build, all 53 unit/API/database
tests, and all six browser scenarios. Desktop/mobile screenshots confirmed
the full boat composition and light theme even with dark browser preferences.
Provider tests exercise real Better Auth authorization handlers with fixture
credentials/discovery; browser tests cover provider errors, cancellation,
password visibility, real email login, and the existing Devnet demo. The first
full browser run exposed missing bootstrap controls in the disposable database;
initializing them restored readiness. Test account creation now respects the
real signup rate limit as the suite grows.

Google/GitHub OAuth application credentials and the company OIDC discovery/client
configuration must still be supplied in Northflank. No real external-provider
authentication was performed without those credentials.

## Light-only theme — 2026-10-11

- [x] Trace the mixed theme to automatic Nuxt UI color-mode switching.
- [x] Disable theme switching and enforce light page tokens and native controls.
- [x] Verify lint, typecheck, build, and browser rendering with dark system/saved preferences.

### Review

Disabled Nuxt UI color-mode registration, set the root light class, and forced
native controls to use only the light color scheme. Lint, typecheck, and the
production build passed. Chromium checks passed on sign-in, sign-up, password
reset, and documentation under both light and dark system preferences with
a saved dark preference. Desktop and mobile sign-in screenshots confirmed
readable text, white inputs, and consistent button colors.

## Devnet MVP completion — 2026-10-10

Scope: a self-service Devnet pilot with one clearly selected project per user,
real wallet-first sponsored payments, resumable reserve migration, accurate
shared sponsor accounting, and recoverable operations. Custodian/mainnet signing
remains outside this Devnet release. No signing keys or API keys enter client
logs or server requests from the demonstration wallet.

- [x] Implement canonical shared treasury accounting, atomic project budgets/quotas, and safe authorization retries.
- [x] Add failed-job visibility and safe reconciliation/recovery, with API/database regression tests.
- [x] Build guided onboarding/readiness, a first-payment flow, and a browser-only disposable Devnet wallet.
- [x] Add live transaction details, clear errors/empty states, visible network status, and resumable migration plans.
- [x] Add password reset with a configured email transport and explicit unavailable behavior without one.
- [x] Provide a runnable developer integration sample with server-only credentials and real signing/polling.
- [x] Resolve dependency audit findings where supported, and verify remaining advisory applicability explicitly.
- [x] Add repeatable migration/deployment tooling, liveness/readiness checks, and hosted operations documentation.
- [x] Run lint, typecheck, unit/API/database tests, production/container builds, browser checks, and an authorized Devnet smoke where available.
- [x] Record verified results and any external provisioning requirements.

### Acceptance criteria

A new tester can sign up, recover/retry onboarding, understand readiness, fund
a disposable Devnet wallet, review/sign a sponsored payment, and observe its
validated result. Reloading a transaction or migration restores its progress.
Concurrent projects cannot independently spend the same sponsor capacity or
exceed configured project budgets. Recovery preserves ledger finality and
never releases uncertain commitments. Cross-tenant access and duplicate requests
are covered by integration tests. Builds contain no local secrets.

### Review

Implemented the Devnet pilot flows and server-side integration example. The
browser wallet keeps its private key in tab memory. Transaction detail reloads,
exact authorization retries, tenant isolation, mobile layout, and onboarding
recovery passed all three Chromium scenarios, including desktop and mobile
screenshot review. Final verification passed lint, typecheck, all 38
unit/API/database tests, and the production build on Nuxt 4.6.1. The final
runtime and tools Docker images built successfully; runtime liveness, dependency
health, sign-in, documentation, and authentication configuration returned HTTP 200.

Live Devnet smoke validated a sponsored payment, account reserve migration,
and reserve release:
- Payment: `4EAA7E5965564BF7AE380D8420B9D8B940992E79E30A2DC5C9CF206124E04B39`
- Migration: `57DF24248F99F96804A05171C1C46B662669183E38E24F5A911E33FC64E47CD9`
- Cleanup: `D2E4FA79625D97289B7B128FFCE147FDFA66D893A841127C27714B58B1FD1A92`

The runnable example independently validated payment
`15970B4ED19E16AC39759CC5A08C43EF43D2A12D7C3F066557F5FEB7E870C988`.
Current Devnet requires the role-specific sponsor signing prefix enabled by
`fixCleanup3_4_0`; the signer and protocol gate now enforce that behavior. The
reviewed definitions hash was updated only after the live smoke passed.

Container checks passed with the nonroot runtime, no local environment files,
HTTP 200 liveness/dependency health, running worker heartbeat, and repeated
migrations/admin bootstrap through the separate tools image. The Better Auth
upgrade includes an incremental nullable-issuer migration preserving old rows.

The production dependency audit reports zero vulnerabilities. The full audit
still reports upstream build/tool dependency advisories, documented in
docs/deployment.md. Inspection of the final standalone output found only
package metadata, with no executable files, for the affected package names;
this does not remove the need to recheck tooling advisories after upgrades.

Northflank provisioning, public hostname/secrets, database backups, and a
verified email sender remain external configuration; no hosted service or
real reset email was provisioned.

## Production Docker image — 2026-10-10

- [x] Inspect the Nuxt build, runtime configuration, and embedded worker.
- [x] Add a multi-stage Node image and exclude local secrets and generated files from the build context.
- [x] Document container startup and Northflank runtime settings.
- [x] Build the image and verify startup, runtime configuration, and image contents.

### Review

Added a multi-stage Node 24 Dockerfile, a .dockerignore that excludes local
environment files and generated artifacts, and deployment instructions. The
runtime runs as the node user with only Nuxt's standalone .output directory.
The worker is disabled only during the build and remains enabled at runtime
unless explicitly disabled. Documented separate migration/admin commands and
the NUXT_XRPL_RPC_URL override needed by the public network statistics route.

Built acme-sponsor-kit:docker-test successfully on Linux ARM64 (253.7 MiB).
An isolated PostgreSQL 17 container loaded the committed baseline schema;
the application container served /sign-in, /docs, and /api/auth/get-session,
honored a runtime public URL and port override, and wrote a fresh running
worker heartbeat. Confirmed the non-root user, runtime file contents, and
absence of application/worker errors in logs. Removed all temporary containers,
the PostgreSQL anonymous volume, and the test network. No hosted deployment or
live XRPL transaction was performed. Dependency installation reported 64 audit
findings across the existing full dependency set, including build dependencies;
this change does not update dependencies.

## Custodian integration compatibility and design — 2026-09-16

Agreed scope: each project selects platform-funded or customer-funded sponsorship.
Connections belong to organizations and have a principal account. Customers
configure their connections in the dashboard. Providers are Palisade, Ripple
Custody, and AWS KMS. Automatic signing and custodian-side manual approval must
be modeled; the local seed remains a development/test option.

- [x] Verify the published SimpleXRPL package and exact provider signing interfaces.
- [x] Prove compatible sponsor signing locally where possible; distinguish this from live provider verification.
- [x] Specify organization connections, project routing, and shared treasury accounting.
- [x] Specify durable provider approvals, retries, cancellation, expiry, and credential handling.
- [x] Record implementation sequencing, acceptance tests, and concrete external prerequisites.

### Review

Added docs/custodian-integration.md and a reproducible offline SDK probe exposed
through npm run check:custody-signing. Inspected published simplexrpl 0.2.0
(gitHead e90c9ccf425f6abefbc49270bd9c40a9d69115c3) and official provider documentation.
The SDK was installed only in an isolated temporary directory; application
dependencies, database, and runtime signing routes were not changed.

Seven offline checks passed using the actual public AwsKmsSigner adapter and an
injected local KMS fixture. The checks cover single ed25519/secp256k1 and multisigned
user envelopes, low/high-S provider signatures, exact payload preservation, and
why the high-level ExternalSigner.sign method is unsuitable for sponsor signing.
Palisade and Ripple Custody expose suitable lower-level signing APIs in published
source, but their exact sponsor payload acceptance and recovery behavior remain
unverified against real services. AWS KMS has no native custodian approval inbox.

The design specifies per-project funding, organization principal connections,
canonical treasury balances, separate project budgets, durable signing jobs,
manual-approval expiry, immutable provider identities, safe retries, and dashboard
setup. Live validation requires an identified sandbox/test key, its credentials
through a secure configuration channel, and a compatible Sponsor-enabled network.
The user confirmed that none is configured yet. Independent review found no
blocking issue in the design/probe; tenant IDs were made explicit on proposed
signing requests for auditable worker routing.

Verification passed: seven offline compatibility checks and npm run verify
(lint, typecheck, 14 unit tests, production build). Existing task-log edits were
preserved. Production custody integration is not represented as implemented.

## SimpleXRPL custody discovery — 2026-09-16

- [x] Trace funding, onboarding, and the existing sponsor account model.
- [x] Trace sponsor signing, submission, and custodian approval constraints.
- [x] Compare the implementation with SimpleXRPL's documented connectors.
- [x] Record findings and prepare the product questions needed before implementation.

### Review

Discovery only; no application implementation changes requested. Current onboarding
creates project-specific records for the same configured local Devnet address;
the funding page displays balances but has no custodian connection workflow.
The duplicated address has independent per-project pending balances and locks,
so a shared production treasury requires account-wide capacity accounting to
avoid overcommitment and double-counted balance reporting.
SponsorSigner is the existing integration boundary, but the factory only constructs
the local signer. Authorization awaits signing inside a database transaction, and
transactions expire after 20 ledgers from preparation.

Reviewed Ripple's SimpleXRPL connector documentation and its linked source at
95b977b15f8950c5bc076b25165217869c0b06d3. Ripple Custody and Palisade connectors
support account discovery and transaction operations; the reviewed signing paths
set the main SigningPubKey/TxnSignature, whereas this application must preserve
the user's signature and attach SponsorSignature. Compatibility needs a focused
custodian-backed proof before adopting the SDK for sponsor signing. Native SDK
submission and long-running approval flows also differ from the existing durable
signed-blob outbox contract.

Questions cover customer-held versus deposited XRP, initial custody providers,
shared versus dedicated capital accounts, delegated signing credentials,
automatic versus manual approvals, and available sandbox/network support.
The existing unit suite passed: 4 files, 14 tests. This does not validate a real
custodian integration. Existing task-log changes were preserved.

## Stop local app — 2026-09-15

- [x] Stop the development server and remove the PostgreSQL container and Compose network.
- [x] Verify port 3000 is free and preserve the database volume.

### Review

The local app is stopped. Compose has no running services, port 3000 is free,
and `sponsor-kit_acme-postgres` remains available for the next launch.

## Launch app locally — 2026-09-15

- [x] Check startup instructions, dependencies, and existing services.
- [x] Start PostgreSQL, apply migrations, and launch the development server.
- [x] Verify the homepage responds and record the local URL.

### Review

PostgreSQL is healthy, migrations applied, and the local administrator was
created. The development server is running at `http://localhost:3000/`.
The homepage and authentication session endpoint both returned HTTP 200;
the homepage contains the application content and live network fee/reserve values.
File watching failed inside the sandbox even with a higher file-descriptor
limit and polling; the server started successfully outside the sandbox.

## Supplied hero asset and NFT example

- [x] Replace the derived WebP treatment with the supplied `boat.png` asset.
- [x] Remove the public ledger and reserve statistic columns.
- [x] Move a single `NFTokenMint` sponsorship example into the left-side card.
- [x] Show live fee and object-reserve sponsorship values with loading and error states.
- [x] Verify responsive output, tests, typecheck, lint, and production build.

### Review

The hero now uses the supplied dithered boat artwork directly, with an optimized
WebP source and the original PNG retained as fallback. The three network metric
columns were removed, and the reduced left-side card now presents one
`NFTokenMint` flowing from a creator account to XRPL with policy approval, live
network fee sponsorship, and live object-reserve sponsorship. This leaves the
right side open for the full sailboat composition.

The running page rendered both image sources, `NFTokenMint`, a 1-drop sponsored
fee, and the current 0.2 XRP sponsored object reserve. `npm run verify` passed
ESLint, Nuxt typecheck, all 14 Vitest tests, and the production build. The final
card width was first reduced from 980 px to 820 px, then reduced by a further
33% to 550 px so the boat has substantially more unobstructed space. The card's
second endpoint now shows the `rSponsor...72DA` sponsorship account instead of
a clipped network label, keeping the `NFTokenMint` example protocol-accurate.

## Hero focal-point correction

- [x] Decouple the scenic image height from the lower dashboard card.
- [x] Keep both the sail and hull visible at the supplied desktop viewport.
- [x] Verify the production build and rendered homepage.

### Review

The desktop scenic layers now have a dedicated 900 px hero canvas instead of
inheriting the full section height from the metrics card. This preserves the
asset's sail-and-hull composition while leaving mobile behavior unchanged.
`npm run verify` passed ESLint, Nuxt typecheck, all 14 tests, and the production
build; the running development homepage returned `200` after the hot reload.

## Landing-page reference alignment

- [x] Match the supplied header and first-screen hero composition.
- [x] Add the two-tone headline, dual calls to action, and halftone sailboat treatment.
- [x] Recompose the live Devnet metrics and labeled example transaction into the overlapping card.
- [x] Verify responsive behavior, accessibility, lint, typecheck, tests, build, and rendered HTML.

### Review

Reworked the first screen to follow the supplied composition: an opaque wide
header, oversized navy/blue headline, primary and documentation actions, a
monochrome halftone sailboat scene, and a single raised card combining live
network metrics with a clearly labeled example transaction. The runtime network
name now drives the live label, narrow transaction addresses truncate safely,
and repeated logo instances use unique SVG gradient identifiers.

`npm run verify` passed ESLint, Nuxt typecheck, all 14 Vitest tests, and the
production build. A production-server smoke request returned `200` and rendered
the headline, both actions, guest sign-in route, live Devnet values, and example
transaction. Interactive pixel-level browser comparison remains unavailable in
the current browser runtime.

- [x] Define product, tenant, trust, and open-source boundaries.
- [x] Define existing-wallet and per-object reserve migration behavior.
- [x] Scaffold independent Nuxt 4 + Nuxt UI application using npm.
- [x] Implement the ACME visual system, public site, developer console, and admin console.
- [x] Add Better Auth, PostgreSQL/Drizzle schema, tenant/API-key foundations, and onboarding.
- [x] Add capability discovery, reserve inspection, intent API shape, policy evaluation, and state machine.
- [x] Add transaction-specific `SponsorSigner` interface and fail-closed local implementation.
- [x] Add domain and signer contract tests.
- [x] Install dependencies and generate the initial database migration.
- [x] Run lint, typecheck, tests, and production build.
- [x] Verify rendered public and console routes with production-server smoke tests.
- [x] Move the verified project into `../sponsor-kit` and initialize its independent Git repository.

## Review

Implemented a production-shaped Nuxt 4 application with a branded public site,
authenticated developer and admin surfaces, PostgreSQL/Drizzle persistence,
Better Auth, API-key authorization, policy and intent domain models, validated
XRPL reserve inspection, and an asynchronous signer abstraction with a guarded
local implementation. Existing accounts and objects are handled through an
inventory-driven `SponsorshipTransfer` migration flow; fee sponsorship remains
independent and can begin without migrating reserves.

Verification passed with `npm run verify` (ESLint, Nuxt typecheck, 12 Vitest
tests, and production build), `npm audit --omit=dev` (0 vulnerabilities), one
greenfield baseline migration, and production-server route/API smoke tests.
The in-app browser was unavailable in this environment, so visual verification
used server-rendered route responses rather than interactive screenshots.

## Database bootstrap correction

- [x] Apply the initial migrations to the configured PostgreSQL database.
- [x] Align the account table with Better Auth 1.7's issuer-aware identity key.
- [x] Add a production-safe migration and an auth-schema regression test.
- [x] Add and verify the idempotent `npm run db:setup` command.
- [x] Verify live signup, clean up the smoke-test user, and rerun all checks.

## Default platform administrator

- [x] Define safe local defaults and production credential requirements.
- [x] Add the Better Auth admin plugin and its fields to the baseline schema.
- [x] Regenerate one clean baseline migration and reset only the local development database.
- [x] Add an idempotent administrator bootstrap command.
- [x] Enforce administrator access on the server and `/admin` route.
- [x] Add regression tests, document credentials, and verify end to end.

## Review

Integrated Better Auth's admin plugin on both server and client, added its role,
ban, and impersonation fields, and regenerated the greenfield database as one
baseline migration. `db:setup` now creates the local admin idempotently. Known
defaults require an explicit local flag, a localhost database, and a
non-production environment; non-local environments require explicit secrets.
Both route middleware and a reusable server guard enforce the admin role.

Verified a real admin login, `401` without a session, `403` for an authenticated
regular user, and `200` for the admin API and `/admin`. Temporary test data was
removed. The final suite passes lint, typecheck, 12 tests, production build, and
an npm production audit with zero vulnerabilities.

# Functional admin control plane

- [x] Replace all static admin metrics with database aggregates.
- [x] Report real database, signer, XRPL RPC, queue, and reconciliation health.
- [x] Add persistent global sponsorship pause/resume with audit logging.
- [x] Replace static audit events and capabilities with live data.
- [x] Add loading, refresh, failure, empty, and mutation states to the UI.
- [x] Reset the greenfield baseline schema and bootstrap local admin data.
- [x] Verify API authorization and persisted administrative actions.
- [ ] Verify interactive browser behavior when an in-app browser is available.

## Review

The admin console now reads PostgreSQL aggregates and live signer, XRPL, worker,
queue, and reconciliation health. Global pause/resume is persisted with
optimistic concurrency and audit records. Authorization smoke checks returned
`401` without a session and `200` for the bootstrapped administrator; pause and
resume survived reloads. The in-app browser runtime was unavailable, so HTTP
route checks replaced interactive browser verification for this pass.

# Production Devnet implementation

- [x] Confirm the configured public Devnet supports and has enabled the `Sponsor` amendment.
- [x] Confirm Devnet advertises `SponsorshipSet`, `SponsorshipTransfer`, `Sponsorship`, and sponsorship fields through `server_definitions`.
- [x] Replace draft-derived protocol constants with validated, cached live server definitions and fail closed on incompatible definitions.
- [x] Replace demo capability and intent behavior with a real XRPL client, durable intent workflow, and validated-ledger state transitions.
- [x] Implement the local `SponsorSigner` adapter behind the production KMS/custodian interface without exposing sponsor key material.
- [x] Implement canonical sponsee/sponsor signing, submission, retry/idempotency, expiry, and validated-result reconciliation.
- [x] Make project onboarding, API keys, policies, budgets, sponsor accounts, funding, wallet inventory, reserve transfers, and transaction history API-backed.
- [x] Implement existing-wallet ownership proof and explicit per-object/account `SponsorshipTransfer` operations.
- [x] Replace all static developer/admin/dashboard state and actions with authenticated APIs and honest loading, empty, degraded, and error states.
- [x] Add persistent global/project controls, quotas, abuse protection, audit trails, worker leases/heartbeats, and operational reconciliation.
- [x] Remove production demo paths and keep deterministic fixtures exclusively in automated tests.
- [x] Add automated domain/signer tests plus Postgres-backed HTTP/auth and real Devnet lifecycle smoke coverage.
- [x] Run lint, typecheck, tests, production build, dependency audit, and real Devnet smoke transactions.
- [ ] Add a deterministic local XRPL stub and interactive browser end-to-end suite.

## Review

The production flow now verifies the live Sponsor amendment and an allowlisted
`server_definitions` hash before preparing or signing. The wallet signs first;
the backend validates that exact envelope and ledger authorization, attaches the
sponsor signature through the signer interface, persists byte-identical final
transaction bytes, and lets a leased outbox worker submit and reconcile only
validated outcomes.

A real Devnet smoke validated fee sponsorship and an existing-account
`SponsorshipTransfer`, verified the resulting `AccountRoot.Sponsor`, then ended
the sponsorship and reconciled the released reserve. The final run produced
payment hash `B3EE6895D826AF59CC84AB0C9E1FAC6D4CA737B2AD745869B8CB7BF834A6BFB6`,
migration hash `5293D7E7734097C2F16CE8571FB518AD83B72A403F770D553C2F52B5C6DCDBDF`,
and cleanup hash `0A9FA740FACDCC2D54BE1E650D96850A4A6AD6B0FD889D10AC837389183F3C7C`.

Final verification passed ESLint, Nuxt typecheck, 12 Vitest tests, the production
build, `npm audit --omit=dev` with zero vulnerabilities, idempotent database
setup, authenticated HTTP route checks, and the real Devnet smoke. Interactive
browser testing and a local XRPL stub remain intentionally unchecked because the
browser runtime was unavailable and the authoritative end-to-end path used the
configured public Devnet.

# Public integration documentation

- [x] Audit the implemented public API, authentication, signing contract, errors, and finality semantics.
- [x] Define the direct-integration path and the future xrpl-connect abstraction boundary without inventing unsupported SDK APIs.
- [x] Add a complete repository integration guide and endpoint reference.
- [x] Expand the in-app `/docs` guide with copyable, production-safe examples.
- [x] Link the documentation from the README and verify lint, typecheck, tests, and production build.

## Review

Added a complete direct-integration guide, expanded the public `/docs` route,
and corrected the architecture trust-boundary diagram. The guides explicitly
separate the available REST API from the future `xrpl-connect` abstraction,
document the backend-for-frontend boundary, exact wallet-first signing order,
idempotency, scopes, endpoint contracts, reserve migration, errors, and validated
finality.

Verification passed with `npm run verify`: ESLint, Nuxt typecheck, 14 Vitest
tests, and a production build that prerendered `/docs`. The running development
server returned the complete documentation page at `http://localhost:3000/docs`.
The in-app browser runtime reported no available browsers, so interactive copy
button and responsive-layout checks could not be performed in that surface.

# Landing-page first screen

- [x] Replace the public header's duplicate auth actions with one session-aware console CTA.
- [x] Build the screenshot-directed sailboat hero with responsive, accessible layout behavior.
- [x] Replace illustrative adoption numbers with non-sensitive live Devnet metrics.
- [x] Rebuild the transaction preview and first-screen metric panel without presenting examples as live data.
- [x] Verify guest/authenticated routing, live metric output, lint, typecheck, tests, build, and rendered homepage content.

## Review

Rebuilt the first landing screen around an optimized 143 KB sailboat WebP,
responsive full-bleed composition, headline, single onboarding CTA, three trust
signals, live Devnet metric panel, and a clearly labeled example transaction.
The public header now contains only Docs and one session-aware action: guests see
Sign in with a safe `/app` redirect, while authenticated users see Open console.
Public pages are request-rendered so this state is correct in the first response.

The metric panel intentionally uses public XRPL state instead of disclosing
tenant adoption aggregates: validated ledger index, account reserve, object
reserve, and base fee come from the configured Devnet endpoint through a cached
backend API. The endpoint and homepage returned real live values, guest and admin
HTML returned the expected CTA/link, and `npm run verify` passed ESLint, Nuxt
typecheck, 14 Vitest tests, and the production build. The browser-control runtime
reported no available browser, so the responsive visual pass remains limited to
the supplied reference, generated asset inspection, and rendered HTTP output.

# Landing-page second screen

- [x] Replace the generic capability-card section with the supplied two-column composition.
- [x] Build a responsive, code-native application → ACME API → XRPL ledger visual.
- [x] Verify content, responsive source structure, lint, typecheck, tests, build, and live rendering.

## Review

Replaced the original generic capability cards with the supplied second-screen
composition: focused copy and four integration responsibilities on the left, plus
a responsive, accessible, code-native application → ACME API → XRP Ledger stack
on the right. The section fills the viewport below the sticky public header and
collapses cleanly to a single column on smaller screens. Live SSR output includes
all expected content. `npm run verify` passed ESLint, Nuxt typecheck, 14 Vitest
tests, and the production build.

# Landing-page third screen

- [x] Make the existing-wallet experience the third screen in the landing-page sequence.
- [x] Match the supplied migration inventory and light final CTA composition responsively.
- [x] Verify content, navigation, lint, typecheck, tests, build, and live SSR output.

## Review

Removed the generic numbered-step strip so the existing-wallet section is the
actual third screen. Rebuilt it as one responsive viewport containing the supplied
migration explanation, dark validated-ledger inventory, and light final project
CTA. Preserved the real reserve-migration and sign-up navigation targets. Live SSR
output contains every expected label and no longer contains the removed step strip.
`npm run verify` passed ESLint, Nuxt typecheck, 14 Vitest tests, and the production
build.
