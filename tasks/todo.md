# ACME Sponsor Kit

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
ESLint, Nuxt typecheck, all 14 Vitest tests, and the production build.

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
