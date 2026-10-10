# First sponsored Devnet payment

This runnable example sends **one drop of Devnet XRP**, with ACME paying the
transaction fee. It uses the real create → wallet sign → authorize → validated
flow, rather than a simulated transaction.

Requirements:

- Node.js 24 and `npm ci` in the repository root.
- A running, healthy ACME deployment with a funded Devnet sponsor.
- A project API key with `intents:create` and `intents:read`, created in the console.
- A funded Devnet destination address, for example the sponsor account.

Set these variables in your shell or a local, ignored `.env` file:

```dotenv
ACME_BASE_URL=https://your-app.example.com
ACME_PROJECT_ID=proj_your_project
ACME_API_KEY=your_server_only_key
ACME_EXAMPLE_DESTINATION=rYourFundedDevnetDestination
```

Run from the repository root:

```bash
npm run example:payment -- --confirm-devnet
```

The example generates a new disposable wallet in process memory, funds its
public address through the Devnet faucet, prepares a payment, checks the exact
business fields and protocol definitions, signs locally, and submits the signed
blob and grant to ACME. The seed/private key never reaches ACME and is never
printed or saved. The wallet cannot be recovered after the process exits.
Use this only with disposable Devnet funds.

The API key stays in the Node process. `lib/acme.mjs` is a small server-side HTTP
client you can adapt into your own backend. In a browser application, the
user's wallet signs the returned transaction in the browser and sends only the
signed blob and grant to your backend. Never bundle the API key into client code.

The printed intent ID lets you resume confirmation after an interruption:

```bash
npm run example:payment -- --resume your-intent-uuid
```

Resume polls the existing intent and does not generate another wallet or submit
another payment. A timeout or lost HTTP response does not prove failure: inspect
the intent before starting a replacement. The client requires a stable operation
ID for creation and sends it as `Idempotency-Key`. Only `validated` is success;
`submitted` means the ledger outcome is still pending.

Faucet availability and Devnet resets can interrupt the example. It uses the
public Devnet faucet and RPC to observe wallet funding; the ACME project's
protocol endpoint verifies its configured network and definitions before signing.
Transactions, grants, keys, and arbitrary HTTP error bodies are omitted from logs.

For a browser-based demonstration with the same trust boundary, open **Try
sponsorship** in the developer console. The console uses your authenticated
session, so it does not need an API key in the browser.
