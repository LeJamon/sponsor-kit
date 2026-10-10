# Custodian integration design

Status: compatibility research and proposed implementation, 2026-09-16. The
dashboard, database changes, and production provider adapters described below
are **not implemented**. The checked-in offline probe verifies the KMS signing
boundary; it does not verify any live provider or network.

## Agreed product behavior

- Each project chooses `platform` or `customer` funding. Projects in the same
  organization may choose different modes.
- Platform-funded projects use the platform organization's principal sponsor
  account. Customer-funded projects use their own organization's principal
  account, with XRP remaining under that organization's control.
- Customers configure organization connections through their dashboard.
- Target providers are Palisade, Ripple Custody, and AWS KMS. KMS holds a signing
  key; the corresponding XRP belongs to its XRPL account.
- Automatic signing and manual approval are supported where the provider offers
  them. Human approvals happen in the custodian interface; ACME displays status.
- Backend seeds remain a development/test mechanism. A production connection
  failure never falls back to a seed or another organization's capital.

## Compatibility results

Reviewed the published `simplexrpl@0.2.0` package, not only the documentation's
older source links. Registry `gitHead`:
`e90c9ccf425f6abefbc49270bd9c40a9d69115c3`. Package integrity:
`sha512-13rBjpc9fUV23P3gDhJ6qRGKlrhF0VEMzViFGbrDgrsQ+bQWsmbqdJkxLnEiQJBUTJBrsWbUBQSzoYrF2Mpfwg==`.
See the [published package metadata](https://registry.npmjs.org/simplexrpl/0.2.0).

| Provider | Integration point | Evidence and remaining gate |
| --- | --- | --- |
| AWS KMS | Public `AwsKmsSigner` from `simplexrpl/aws-kms`; obtain public key and sign the prepared 32-byte digest, then attach locally | Seven offline checks pass, including high-S normalization and preservation of single/multisigned envelopes. Live IAM/key configuration and ledger validation remain untested. |
| Ripple Custody | `custody.api.propose()` for `v0_SignManifest`, followed by intent and manifest retrieval through `custody.api.call()` | Provider documents arbitrary-byte signing. Exact sponsor-payload acceptance, key hashing semantics, governance, recovery, and network suitability require a sandbox test. |
| Palisade | `palisade.api.call('TransactionsService_RawTransaction', ...)` with `signOnly: true`; retrieve the independent signature | Published schema provides raw transaction operations and signature fields. Exact sponsor-payload acceptance, signature encoding, approval behavior, and recovery after a lost POST response require a sandbox test. |

The [SimpleXRPL external signer contract](https://opensource.ripple.com/docs/simplexrpl/references/connectors/external)
accepts secp256k1 digests. Its high-level `ExternalSigner.sign()` overwrites the
main `SigningPubKey` and `TxnSignature`; the probe confirms that this is not our
sponsor operation. The reviewed custody signing helpers make the same kind of
ordinary transaction signature. Use the public lower-level interfaces while
retaining ACME's `XrplSponsorAdapter` and pinned protocol definitions.

### Provider-specific constraints

For AWS, initially support `ECC_SECG_P256K1`, `SIGN_VERIFY`, and
`ECDSA_SHA_256` with `MessageType: DIGEST`. Send the existing adapter's
SHA-512Half digest, normalize returned scalars to low-S, DER-encode them with a
maintained crypto library, and verify locally before attachment. Validate key
metadata separately; the SDK adapter is not an onboarding validator. AWS's
[Sign API](https://docs.aws.amazon.com/kms/latest/APIReference/API_Sign.html)
returns a signature, not a pending human-approval request. Consequently the KMS
connection initially advertises automatic signing only; manual mode requires an
additional approval service and is not silently simulated in ACME.

Ripple's [arbitrary-payload signing](https://docs.ripple.com/products/custody/governance/intents/sign-and-store-payloads)
uses an `Unsafe` manifest and returns an independent signature. Availability
depends on the deployment permitting that operation. It does not provide the
transaction-policy interpretation of a native payment order. The implementation
must bind a readable approval summary to the exact payload hash without claiming
the provider enforces ACME's destination/fee policy. Manifest signing cancellation
has not been established; transaction-order cancellation is a different operation.

Palisade's [raw-signing documentation](https://docs.ripple.com/products/wallet/user-interface/transactions/raw-signing)
distinguishes signing transaction bytes from plaintext messages. Use the exact
XRPL signing preimage, not `sign-plaintext`. Extract and validate the independent
`signature`/`canonicalSignature` according to the provider's verified encoding;
do not accept a replacement ordinary `signedTransaction` as a sponsor envelope.
Treat raw-operation cancellation as unsupported until verified.

References for the published SDK implementation:
[Ripple raw signing](https://github.com/ripple/simpleXRPL/blob/e90c9ccf425f6abefbc49270bd9c40a9d69115c3/src/custodians/ripple/submission/raw-sign.ts),
[Ripple public API](https://github.com/ripple/simpleXRPL/blob/e90c9ccf425f6abefbc49270bd9c40a9d69115c3/src/custodians/ripple/api.ts),
[Palisade connector](https://github.com/ripple/simpleXRPL/blob/e90c9ccf425f6abefbc49270bd9c40a9d69115c3/src/custodians/palisade/palisade-custody.ts).

## Data ownership and routing

This is the proposed replacement for the current project-owned duplicate sponsor
rows. A single physical account must have one balance and one reservation lock.

| Record | Ownership and invariant |
| --- | --- |
| `custody_connections` | Organization-owned provider configuration, environment, secret reference, capabilities, status, and immutable configuration versions. No plaintext credential in API responses or database metadata. |
| `custody_accounts` | Discovered provider account reference, connection version, network, address, and verified public key. Account discovery alone does not establish sponsorship capability. |
| `sponsor_accounts` | Canonical treasury identity, unique by network and address, owned by one organization. Remove project ownership; bind a verified custody account or development signer. Reject conflicting cross-organization ownership claims. |
| `organization_funding_defaults` | One principal account per organization and network. The platform organization is resolved server-side, never from customer input. |
| `project_funding` | Project funding mode, version, fee budget, and reserve-exposure limit. Customer mode resolves only the project's organization default; platform mode resolves the platform default. |
| `funding_balances` | One aggregate balance/reservation row per canonical sponsor account, shared by every project using it. |
| `project_funding_balances` | Project usage and pending budget reservations; not a second copy of treasury XRP. |
| `signing_requests` | Immutable organization/project/intent IDs, connection version, treasury/account/key identity, exact payload/hash, deterministic provider request key, provider ID, state, deadlines, attempts, and final signature metadata. Worker lookups enforce consistency with the intent and funding owner. |

Resolve and snapshot the funding mode, sponsor account, connection version, key,
network, and project funding version when creating an intent. Customer defaults
and project funding changes apply to new intents. They cannot change an existing
user-signed transaction. Pause/revocation still prevents new signing/submission.

Outstanding reserve obligations stay attached to their original sponsor account
when a project changes mode or an organization changes its principal connection.
Keep old accounts reconcilable; moving those obligations requires explicit
`SponsorshipTransfer` transactions. Never delete an account with unresolved
intents or obligations.

Existing `sponsor_accounts` rows must be consolidated by network/address. Preserve
intent and obligation references, sum genuine per-project pending reservations,
and obtain one fresh ledger balance rather than summing duplicate observations.
The development schema can be regenerated as a baseline; resetting an existing
database is a separate explicit operation, not part of generation.

## Capital accounting

Lock the canonical treasury balance and project budget in a consistent order
when accepting authorization. Reserve both fee and prospective reserve exposure
in the same database transaction as the signing job. Separate project fee-spend
limits from reserve-capital limits; customer funding still requires those
controls because several projects can share the customer's treasury.

Physical capacity is validated on-chain balance minus current on-chain reserve,
treasury safety buffer, and all pending fee/reserve commitments. Current on-chain
reserve already includes validated sponsorship obligations; do not subtract the
same locked reserve twice. Per-project allowances are additional ceilings, not
funds that increase physical capacity.

Use monotonic, ledger-indexed balance observations. Before releasing a validated
transaction's pending commitment, reconcile a balance at or after its validation
ledger, so an old balance cannot make spent XRP appear available again. External
custodian withdrawals can reduce capacity: recheck before signing/submission and
report insufficient capacity without switching funding source. Admin totals
count each physical account once; customer APIs expose only that customer's
usage and permitted account information.

## Signing and approval lifecycle

Keep `SponsorSigner` as a transaction-specific trust boundary. Add a durable
provider-operation interface beneath it for starting and observing signing;
do not expose a public arbitrary-digest signing endpoint.

```text
wallet authorization
  -> verify exact envelope and ledger authorization
  -> commit grant consumption + capital reservation + signing job
  -> signing worker starts or resumes provider operation
  -> awaiting custodian approval (when required)
  -> signature verified and SponsorSignature attached locally
  -> commit final immutable blob + submission outbox event
  -> submit exact saved bytes -> reconcile validated ledger result
```

The authorization API returns `202` with `awaiting_sponsor_signature` once the
job is durable, even if the provider usually signs immediately. Return the same
accepted status on an exact retry of the consumed grant and signed blob; a
different blob or grant remains invalid. Move signing outside database locks.

Before the first external call, persist a request UUID and hash bound to the
intent, connection version, account, and payload. Retries use that identity.
Persist provider operation IDs and poll with leased jobs and backoff. A timeout
means unknown/pending, not rejection. Reconcile a lost response before posting
again; if the provider cannot find an operation by a deterministic identifier,
retain `submission_unknown` and require operator resolution rather than issuing
another request with a new ID. For KMS, retried signatures can differ: select and
persist exactly one final blob with compare-and-set before any submission.

Provider rejection, transport failure, approval pending, signature available,
and ledger validation are distinct states. Display sanitized provider status and
an approved custodian-console link. Provider callbacks, if added, are authenticated
wake-up signals; retrieve authoritative status before changing financial state.
Polling remains sufficient when a provider offers no usable callback.

Immediately before attaching/submitting, recheck deadline, account sequence,
ledger signer authorization, protocol definitions, pause/revocation, and policy
eligibility. Verify the returned signature against the pinned public key and
exact preimage, including low-S requirements for secp256k1. The existing adapter
requires the sponsor address to derive from that key; regular-key or sponsor
multisign custody accounts require explicit authorization support and separate
tests before activation.

### Manual approval and expiry

The current fixed `LastLedgerSequence = prepared ledger + 20` is unsuitable for
many human approvals. Define bounded, project-policy approval windows and their
ledger windows before the wallet signs, with enough submission margin. Show
the actual expiry; provider intent lifetime must not be mistaken for XRPL
transaction lifetime. Longer windows increase the time capital is reserved and
do not guarantee the account sequence remains usable.

An approval arriving too late never authorizes changing the fee, sequence,
sponsor, or `LastLedgerSequence`. Mark the old request expired and require a new
intent, new wallet signature, and a new provider approval. Do not transfer an old
approval to a new payload. Support cancellation only to the extent the provider
supports it; a local cancellation request does not prove remote cancellation.

With a verified sign-only provider, ACME is the only broadcaster, and unsubmitted
requests can be fenced against submission before releasing their reservations.
Workers that return late must lose the compare-and-set race and discard the
artifact. Once broadcasting may have occurred, keep commitments until a validated
result or complete ledger-range search establishes finality. Pauses and revoked
credentials must not stop reconciliation of previously submitted transactions.

## Dashboard and credentials

Organization owners/admins manage connections; project owners/admins select
funding mode and limits. Apply server-side organization membership, management
role, and same-origin checks to all mutations. Never accept a foreign connection
ID merely because the authenticated user can access a project.

Connection setup progresses through credentials configured, account discovered,
network/key verified, and sponsorship verified. Show unsupported capabilities
explicitly; a successful balance lookup is not evidence that signing works.
Offer manual approval only for a verified custodian workflow. Connection/key
rotation creates a new version, with old versions retained for outstanding jobs.

Palisade uses scoped API credentials; Ripple Custody uses its intent-author
credential and deployment endpoints. Store these through the deployment's secret
store with tenant-bound access and audited updates; keep only opaque references
in PostgreSQL. The console never reads a saved secret back. Pass validated PEM
contents to the SDK, not customer-supplied filesystem paths or secret-store ARNs.
Validate provider hosts and enforce outbound network restrictions for configurable
gateway/token URLs. Disable redirects or revalidate their destinations.

For KMS, collect a key ARN, region, and customer role ARN. Supply a platform-generated
external ID and use STS temporary credentials; do not request long-lived AWS access
keys. Verify the trust policy requires the external ID and permissions are scoped
to the selected key. Construct the SDK's KMS client with those temporary credentials.
See AWS's [third-party role guidance](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_common-scenarios_third-party.html).

## Implementation sequence and release gates

No provider sandbox or AWS test key/role is configured yet, as confirmed by the
user. The following live checks remain outstanding; offline fixtures cannot
establish provider acceptance or deployment permissions.

1. Establish a real test connection for each provider and prove exact sponsor
   signing against an enabled, allowlisted Sponsor network. Validate both normal
   and delayed approval, rejection, lost response, and late completion. Keep
   unsupported provider/network combinations unavailable.
2. Introduce organization connections, canonical treasuries, project funding
   configuration, and atomic account/project budgets. Verify two concurrent
   projects cannot reserve more than a shared account holds.
3. Introduce durable signing requests and retries, implement provider bridges
   through the verified SimpleXRPL surfaces, then connect the existing immutable
   blob outbox. Verify restart recovery at every commit/external-call boundary.
4. Add customer connection setup and funding selection, pending approval status,
   provider health, and operator troubleshooting. Remove current hardcoded
   `projects[0]` selection where it prevents choosing a project's funding mode.
5. Exercise tenant authorization, credential rotation, funding-mode changes with
   outstanding reserves, expiry, duplicate callbacks, budget enforcement, and
   validated failure accounting. Run lint, typecheck, unit/integration tests,
   production build, and controlled provider-backed ledger tests before rollout.

Production network support is a separate gate: the current definitions loader
and signer factory intentionally restrict the application to Devnet. Validate
network identity, amendment activation, codec definitions, and provider account
network together before extending this. A working custody connection does not
enable Sponsor on an unsupported network.

## Reproduce the offline proof

Install the optional probe dependencies outside the application's dependency tree:

```sh
probe_dir=$(mktemp -d /private/tmp/sponsor-custody-proof.XXXXXX)
npm install --prefix "$probe_dir" --cache "$probe_dir/npm-cache" \
  --ignore-scripts --no-audit --no-fund --save-exact \
  simplexrpl@0.2.0 @aws-sdk/client-kms@3.1133.0 @noble/curves@1.9.7
npm run check:custody-signing -- --sdk-dir "$probe_dir"
```

The probe calls the actual SDK `AwsKmsSigner` using an injected local KMS fixture
that returns SPKI public keys and DER signatures. It verifies six combinations
of user signature mode and low/high-S provider signatures, exact preservation of
the user envelope, and the incompatibility of the ordinary `ExternalSigner.sign`
path. It uses generated test keys, never reads `.env`, and performs no AWS,
custodian, or XRPL requests. Curve signing, DER normalization, and local signature
verification are real; provider responses, account authorization, and protocol
definitions are fixtures. No live compatibility claim follows from these checks.
