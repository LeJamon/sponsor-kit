# ACME sponsorship integration

For a complete runnable Devnet payment, start with [the integration example](../examples/README.md).

This guide describes the HTTP API implemented by Sponsor Kit. It is the direct
integration path for applications that do not use `xrpl-connect`. The planned
`xrpl-connect` adapter will implement the same lifecycle and hide the transport
and wallet-signing handoff; it will not change the trust model described here.

> ACME currently defaults to XRPL Devnet. Devnet is experimental and can reset.
> Do not treat Devnet balances, accounts, transaction history, amendment support,
> or definition hashes as durable production state.

## What ACME does

ACME coordinates two independent signatures on one XRPL transaction:

1. Your backend asks ACME to prepare a sponsorship intent.
2. ACME fills the account, fee, sequence, ledger deadline, sponsor, and sponsor
   flags, checks project policy, simulates reserve impact, and returns the exact
   canonical transaction.
3. Your wallet integration signs that exact transaction with the user's XRPL
   key. It does **not** submit the transaction.
4. Your backend exchanges the wallet-signed hexadecimal blob and the one-time
   grant for sponsor authorization.
5. ACME verifies the user's signature and ledger authorization, rechecks the
   transaction, policy, sequence, deadline, sponsor capacity, pauses, and live
   protocol definitions, then adds the sponsor signature.
6. ACME persists the final bytes, submits them asynchronously, and reconciles
   the result against a validated ledger.

The sponsor key never leaves the signer boundary. ACME does not receive, store,
or derive the user's private key.

## Integration paths

### Direct HTTP API

Use the API in this document when you own the wallet integration or want to
integrate before the `xrpl-connect` adapter is available. You must implement the
wallet-signing handoff and status polling.

### xrpl-connect

`xrpl-connect` remains the open-source, wallet-facing integration layer. Its ACME
adapter should call the same create, authorize, and status endpoints, present the
canonical transaction to the selected wallet, and return the validated result to
the application. Until that adapter ships, use the direct HTTP API below. No
`xrpl-connect` sponsorship method is documented here because it does not exist
yet.

## Before the first request

Create a project, active sponsor account, active policy, and API key in the
developer console. Store the API key in a secrets manager or server-only
environment variable. Never put it in browser code or a `NUXT_PUBLIC_` variable.

The public API uses these scopes:

| Scope | Allows |
| --- | --- |
| `intents:create` | Create intents and inspect existing reserve targets. |
| `intents:read` | Read an intent and project network capabilities. |

API keys are sent as bearer credentials:

```http
Authorization: Bearer acme_dev_sk_...
```

All XRP amounts are decimal strings in drops. Never convert them through a
floating-point number.

## End-to-end direct integration

The safest deployment keeps all ACME HTTP calls on your backend. Your frontend
receives only the signing package, asks the wallet to sign it, and sends the
signed blob back to your backend.

### 1. Create an intent from your backend

```ts
const ACME_BASE_URL = process.env.ACME_BASE_URL!
const ACME_PROJECT_ID = process.env.ACME_PROJECT_ID!
const ACME_API_KEY = process.env.ACME_API_KEY!

export async function createSponsoredPayment(input: {
  walletAddress: string
  destination: string
  amountDrops: string
  operationId: string
}) {
  const response = await fetch(
    `${ACME_BASE_URL}/api/v1/projects/${ACME_PROJECT_ID}/intents`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ACME_API_KEY}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': input.operationId
      },
      body: JSON.stringify({
        account: input.walletAddress,
        transaction: {
          TransactionType: 'Payment',
          Destination: input.destination,
          Amount: input.amountDrops
        },
        sponsorship: { fee: true, reserve: false },
        signing: { mode: 'single', signerCount: 1 }
      })
    }
  )

  if (!response.ok) {
    throw new Error(`ACME intent creation failed: ${response.status} ${await response.text()}`)
  }

  return response.json()
}
```

`Idempotency-Key` is required, may contain at most 128 characters, and must
identify one logical operation. Reusing it with the same request returns the
same intent. Reusing it with different request data returns `409`.

The request transaction must contain `TransactionType` and the business fields
the user intends to authorize. Omit all ACME-managed fields:

```text
Account, Fee, Sequence, LastLedgerSequence, NetworkID,
Sponsor, SponsorFlags, SponsorSignature,
SigningPubKey, TxnSignature, Signers
```

ACME returns `201 Created`:

```json
{
  "id": "85e57c14-7ed4-4a63-b6c2-f642c36f13e4",
  "state": "awaiting_user_signature",
  "network": "devnet",
  "networkId": 2,
  "definitionsHash": "1EA05B0F...E0FF5",
  "account": "rUser...",
  "transaction": {
    "TransactionType": "Payment",
    "Destination": "rDestination...",
    "Amount": "25000000",
    "Account": "rUser...",
    "Fee": "10",
    "Sequence": 42,
    "LastLedgerSequence": 12345698,
    "Sponsor": "rSponsor...",
    "SponsorFlags": 1
  },
  "canonicalHash": "...",
  "sponsorship": {
    "feeDrops": "10",
    "reserveDrops": "0"
  },
  "expiresAt": "2026-08-18T14:30:00.000Z",
  "grant": "grant_..."
}
```

The transaction and grant are an inseparable signing package. Discard both when
the intent expires.

### 2. Ask the wallet to sign, not submit

The exact wallet API depends on the provider. Your adapter must satisfy this
contract:

```ts
export interface XrplWalletSigner {
  /** Return the complete XRPL transaction as a serialized hexadecimal blob. */
  signTransaction(input: {
    network: string
    transaction: Record<string, unknown>
  }): Promise<{ signedTransaction: string }>
}
```

Call it without autofilling or changing any field:

```ts
const { signedTransaction } = await wallet.signTransaction({
  network: intent.network,
  transaction: intent.transaction
})
```

The returned blob must contain the user's `SigningPubKey` and `TxnSignature`, or
the complete `Signers` array for an XRPL multisigned transaction. It must not
contain `SponsorSignature`. The account transaction is signed first; ACME adds
the sponsor signature afterward. Adding the sponsor signature changes the final
serialized blob and transaction ID.

Draft Sponsor fields must be serialized with the exact XRPL `server_definitions`
identified by `definitionsHash`. A wallet or codec that does not understand
`Sponsor`, `SponsorFlags`, and `SponsorSignature` cannot sign these intents yet.
Check the project capability endpoint before enabling sponsorship in the UI.

### 3. Authorize from your backend

Send the wallet-signed blob and grant to your own backend, then forward them to
ACME:

```ts
export async function authorizeSponsoredIntent(input: {
  intentId: string
  grant: string
  signedTransaction: string
}) {
  const response = await fetch(
    `${ACME_BASE_URL}/api/v1/intents/${input.intentId}/authorize`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant: input.grant,
        signedTransaction: input.signedTransaction
      })
    }
  )

  if (!response.ok) {
    throw new Error(`ACME authorization failed: ${response.status} ${await response.text()}`)
  }

  return response.json()
}
```

This endpoint uses the transaction-bound, short-lived, single-use grant instead
of the project API key. A successful response is `202 Accepted`:

```json
{
  "intentId": "85e57c14-7ed4-4a63-b6c2-f642c36f13e4",
  "state": "submitting",
  "transactionHash": "B3EE6895...A6BFB6",
  "engineResult": null
}
```

`202` means that the final sponsor-signed transaction was accepted for
asynchronous submission. It is not ledger success.

### 4. Poll until terminal

```ts
const terminalStates = new Set([
  'validated', 'failed', 'rejected', 'expired',
  'cancelled', 'superseded'
])

export async function waitForSponsoredIntent(intentId: string) {
  for (let delayMs = 500; ; delayMs = Math.min(delayMs * 2, 5000)) {
    const response = await fetch(`${ACME_BASE_URL}/api/v1/intents/${intentId}`, {
      headers: { Authorization: `Bearer ${ACME_API_KEY}` }
    })
    if (!response.ok) throw new Error(`ACME status failed: ${response.status}`)

    const intent = await response.json()
    if (terminalStates.has(intent.state)) return intent
    await new Promise(resolve => setTimeout(resolve, delayMs))
  }
}
```

Only `state === "validated"` is success. Inspect the latest submission for its
`transactionHash`, `engineResult`, `ledgerIndex`, and `validatedAt`. A transaction
can be submitted and later fail or expire; never deliver goods based only on the
authorization response.

## Fee and reserve modes

`sponsorship` selects what ACME pays for in this transaction:

```json
{ "fee": true, "reserve": false }
```

- `fee: true` pays the transaction fee.
- `reserve: true` sponsors reserve-bearing accounts or objects created by the
  transaction.
- Both can be `true` for the same transaction.
- At least one must be `true`.

Reserve sponsorship does not move XRP to the user. The reserve remains part of
the sponsor's obligation. Account sponsorship also does not retroactively sponsor
objects the account already owns.

### Existing wallets and objects

An existing wallet can immediately use fee sponsorship for future eligible
transactions. Existing account and object reserves require one explicit
`SponsorshipTransfer` per reserve-bearing target:

1. Inspect the wallet at one validated ledger.
2. Select an eligible account or object target.
3. Prepare one transfer using fresh sequence and ledger state.
4. Have the owning wallet sign the exact transfer.
5. Let ACME co-sign, submit, and confirm the resulting `Sponsor` field from a
   validated ledger.
6. Repeat sequentially for the next target.

The direct API currently exposes target inspection. Durable transfer preparation
and progress are handled by the authenticated **Reserve migration** console. Do
not create a normal sponsored transaction and assume it migrates old reserves.
Trust-line migration remains disabled because `HighSponsor` and `LowSponsor`
represent independent reserve-bearing sides.

## API reference

Base URL for local development: `http://localhost:3000`.

### `POST /api/v1/projects/:projectId/intents`

Creates a policy-bound canonical transaction and authorization grant.

- Authentication: bearer API key
- Scope: `intents:create`
- Required header: `Idempotency-Key`
- Optional header: `X-Correlation-ID`
- Success: `201 Created`

Request:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `account` | string | yes | Existing XRPL account that will sign. |
| `transaction` | object | yes | Business fields only; `TransactionType` is required. |
| `sponsorship.fee` | boolean | yes | Sponsor the transaction fee. |
| `sponsorship.reserve` | boolean | yes | Sponsor newly created reserves. |
| `policyId` | UUID | no | Select a specific active project policy. |
| `signing.mode` | `single` or `multi` | no | Defaults to `single`. |
| `signing.signerCount` | 1–32 | no | Defaults to `1`; single signing requires `1`. |

Common failures: invalid request or managed field (`400`), invalid key/scope
(`401`/`403`), policy rejection (`403`), no active sponsor/policy or idempotency
conflict (`409`), wallet rate limit (`429`), or unavailable XRPL capability
(`5xx`).

### `POST /api/v1/intents/:intentId/authorize`

Verifies the user's complete signed blob and atomically consumes the grant before
sponsor signing.

- Authentication: grant in request body
- Success: `202 Accepted`

```json
{
  "grant": "grant_...",
  "signedTransaction": "12000022..."
}
```

Common failures: malformed or mismatched blob (`400`), invalid/expired/consumed
grant or policy rejection (`403`), stale intent/sequence/target or insufficient
sponsor capacity (`409`), and global pause (`503`). An exact retry with the same grant and signed blob returns the existing accepted
submission; a different blob is rejected. Read the intent after an uncertain
response. Create a new intent only when the previous operation is known not to
have been submitted and its sequence or ledger deadline is stale.

### `GET /api/v1/intents/:intentId`

Returns the current state, immutable transaction context, state events, and
submission attempts.

- Authentication: bearer API key
- Scope: `intents:read`
- Success: `200 OK`

The key useful submission fields are:

```json
{
  "state": "validated",
  "submissions": [
    {
      "attempt": 1,
      "transactionHash": "B3EE6895...A6BFB6",
      "engineResult": "tesSUCCESS",
      "ledgerIndex": 12345690,
      "validatedAt": "2026-08-18T14:28:04.000Z"
    }
  ]
}
```

### `GET /api/v1/projects/:projectId/capabilities`

Reads Sponsor amendment support and the live, allowlisted XRPL definitions used
for serialization.

- Authentication: bearer API key
- Scope: `intents:read`
- Success: `200 OK`

Call this during startup and after an incompatibility error. Fail closed if the
capability response is unavailable; never guess Sponsor flags or field encodings.

### `GET /api/v1/projects/:projectId/protocol`

Returns the exact allowlisted XRPL definitions for wallet serialization, together
with `network`, `networkId`, and `definitionsHash`. Requires a bearer API key with
`intents:read`. Check that these values match the prepared intent before signing.
A changed or unsupported protocol fails closed. The runnable example uses this
endpoint with `XrplDefinitions` rather than relying on an outdated bundled codec.

### `POST /api/v1/projects/:projectId/reserve-inspections`

Inspects one account and its owner objects at a pinned validated ledger.

- Authentication: bearer API key
- Scope: `intents:create`
- Success: `200 OK`

```json
{ "account": "rExistingWallet..." }
```

The response contains `networkId`, `definitionsHash`, `ledgerIndex`, `ledgerHash`,
and targets classified as `eligible`, `already_sponsored`, or `unsupported`.
Inspection is read-only and does not prove ownership; ownership is verified when
the wallet signs each exact transfer.

The current Devnet migration workflow supports `AccountRoot`, `Check`, `Escrow`,
`PayChannel`, `MPToken`, `Delegate`, `DepositPreauth`, `MPTokenIssuance`,
`SignerList`, and `Credential`. Treat the response classification as authoritative
instead of maintaining a separate client-side allowlist.

### `GET /api/v1/health`

Returns `200` when the database, XRPL endpoint, signer, and worker are healthy,
or `503` with degraded check details. This endpoint does not require an API key.

### `GET /api/v1/signer/health`

Returns signer availability, adapter metadata, key reference, allowed networks,
and whether local mainnet signing is enabled. It never returns key material and
does not require an API key.

## Intent states

Normal progress is:

```text
awaiting_user_signature → user_signature_received → verified
→ awaiting_sponsor_signature → submitting → submitted → validated
```

The verification and sponsor-signing steps are recorded as append-only events in
one authorization transaction, so polling clients may observe the current state
jump directly from `awaiting_user_signature` to `submitting`. Use `expiresAt` as
the authority for an intent that has not been authorized yet.

Terminal non-success states are `failed`, `rejected`, `expired`, `cancelled`, and
`superseded`. Treat unknown future states as non-terminal and non-successful.

## Security checklist

- Keep project API keys on a trusted backend and grant only required scopes.
- Give every logical operation a unique, stable idempotency key.
- Display the ACME-prepared transaction to the user and sign it byte-for-byte.
- Do not autofill, mutate, or submit the prepared transaction in the wallet.
- Check `expiresAt` before opening the wallet and handle stale sequence/deadline
  conflicts by creating a new intent.
- Verify `state === "validated"` before treating the operation as final.
- Use HTTPS in every non-local deployment.
- Redact API keys, grants, signed blobs, and complete transactions from logs.
- Store amounts as integer drop strings.
- Pin your project to the intended XRPL network and check capabilities before
  presenting sponsorship as available.

## xrpl-connect adapter contract

The future open-source adapter can safely abstract:

- capability checking;
- intent creation through a developer-backend callback;
- wallet selection and signing;
- grant authorization through a developer-backend callback;
- intent polling and normalized errors.

It must not embed the ACME project API key, silently modify the canonical
transaction, submit the user-signed blob directly to XRPL, claim success before
validation, or receive the sponsor private key.
