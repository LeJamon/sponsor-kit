# Architecture

## Trust boundaries

```text
developer backend ── scoped API key ──► ACME API and policy engine
       ▲                                      │
       │ canonical transaction + grant        │ approved immutable envelope
       ▼                                      ▼
wallet / xrpl-connect                 SponsorSigner interface
  signs, never submits                ├─ local (initial adapter)
       │                              ├─ KMS (future)
       │ signed blob + grant          └─ custodian (future)
       └──────► developer backend ─────────────┤
                                              │ final signed blob
                                              ▼
                                 submission + reconciliation worker
                                              │
                                              ▼
                                      validated XRPL ledger
```

The authorization call is normally proxied through the developer backend because
the ACME API does not enable cross-origin browser access by default. The grant is
short-lived, single-use, and bound to the prepared transaction; the project API
key never reaches the wallet or browser.

The signer is a separate trust boundary even when it runs in the same deployment. It receives a transaction-specific request rather than an arbitrary digest and independently validates the network, expected signer, sponsor field, fee, protocol payload, and transaction hash.

## Open-source boundary

Keep the wallet-facing types, intent protocol, verifier, policy schema, `SponsorSigner` contract, and local development adapter open. The hosted multi-tenant control plane, operations, reconciliation, abuse systems, and managed signer deployment can remain commercial. This lets developers audit integration semantics without making the managed service operationally interchangeable with a source checkout.

## Intent lifecycle

```text
created → awaiting_user_signature → user_signature_received → verified
        → awaiting_sponsor_signature → submitting → submitted → validated
```

Terminal states are `failed`, `rejected`, `expired`, `cancelled`, and `superseded`. State changes must be compare-and-set operations with append-only events. A successful HTTP submission is not ledger success.

## Capital accounting

Fee exposure and reserve capital are different ledgers:

- Fee: reserve when approved, capture the actual fee after any validated result (including `tec`), release only when complete ledger history proves the transaction did not validate.
- Reserve: reserve while pending, lock after the resulting account/object is validated with ACME as sponsor, release after validated deletion or sponsorship transfer.

All XRP values are integer drops (`bigint`/decimal strings), never floating-point numbers.

## Existing object migration

An inspection is tied to an account, network, validated ledger index, and object identity. Before asking for a signature, ACME re-reads the target. A state or ownership change supersedes the intent. After submission, ACME reads the validated object again rather than trusting transaction submission metadata.

`RippleState` must be modeled by reserve-bearing side. `HighSponsor` and `LowSponsor` can represent two independent obligations; broad trustline migration remains off until side-specific conformance tests pass.

## Production deployment

- Web/API replicas are stateless behind TLS.
- PostgreSQL is the source for tenants, immutable policy versions, intents, events, capital entries, and audit records.
- An outbox worker performs submission, validation polling, webhook delivery, and reconciliation after database commits.
- API keys store only high-entropy secret hashes; grants are hashed, short-lived, single-use, and transaction-bound.
- Logs use allowlisted structured fields and redact transactions, authorization headers, signing material, and secrets.
- Project pause, signer pause, and emergency global pause are checked immediately before signing and submission.
- Mainnet is denied for the local signer unless explicitly enabled; a KMS/custodian adapter is the expected hosted production configuration.
