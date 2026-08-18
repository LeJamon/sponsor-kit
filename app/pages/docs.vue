<script setup lang="ts">
const navigation = [
  { id: 'overview', label: 'Overview' },
  { id: 'flow', label: 'How it works' },
  { id: 'direct-api', label: 'Direct API' },
  { id: 'signing', label: 'Wallet signing' },
  { id: 'finality', label: 'Status & finality' },
  { id: 'reference', label: 'API reference' },
  { id: 'existing', label: 'Existing wallets' },
  { id: 'security', label: 'Security' }
]

const steps = [
  { title: 'Create', text: 'Your backend creates a policy-bound intent with a scoped API key and idempotency key.', icon: 'i-lucide-file-plus-2' },
  { title: 'Sign', text: 'The wallet signs the exact canonical transaction. It does not broadcast it.', icon: 'i-lucide-pen-line' },
  { title: 'Authorize', text: 'ACME verifies the wallet signature, rechecks policy and capacity, then adds the sponsor signature.', icon: 'i-lucide-shield-check' },
  { title: 'Validate', text: 'A worker submits the final bytes and reconciles the outcome against a validated ledger.', icon: 'i-lucide-badge-check' }
]

const endpoints = [
  { method: 'GET', path: '/api/v1/projects/:projectId/capabilities', scope: 'intents:read', result: 'Live Sponsor amendment and serialization compatibility.' },
  { method: 'POST', path: '/api/v1/projects/:projectId/intents', scope: 'intents:create', result: '201 · Canonical transaction and one-time grant.' },
  { method: 'POST', path: '/api/v1/intents/:intentId/authorize', scope: 'grant', result: '202 · Sponsor-signed transaction queued for submission.' },
  { method: 'GET', path: '/api/v1/intents/:intentId', scope: 'intents:read', result: 'Intent state, events, and submission attempts.' },
  { method: 'POST', path: '/api/v1/projects/:projectId/reserve-inspections', scope: 'intents:create', result: 'Pinned-ledger inventory for an existing wallet.' },
  { method: 'GET', path: '/api/v1/health', scope: 'public', result: 'Database, XRPL, signer, and worker health.' },
  { method: 'GET', path: '/api/v1/signer/health', scope: 'public', result: 'Signer availability and non-secret adapter metadata.' }
]

const terminalStates = [
  { state: 'validated', action: 'Successful validated XRPL outcome. This is the only success state.' },
  { state: 'failed', action: 'The transaction reached a terminal failure. Read the latest engine result.' },
  { state: 'expired', action: 'The ledger deadline passed without validation. Create a fresh intent.' },
  { state: 'rejected', action: 'Policy or authorization rejected the operation.' },
  { state: 'cancelled', action: 'The intent was cancelled before completion.' },
  { state: 'superseded', action: 'Ledger state changed. Inspect or prepare the operation again.' }
]

const securityRequirements = [
  'Keep project API keys on a trusted backend.',
  'Use stable, unique idempotency keys.',
  'Sign the prepared transaction byte-for-byte.',
  'Never let the wallet broadcast before sponsorship.',
  'Treat grants and signed blobs as sensitive.',
  'Store XRP amounts as integer drop strings.',
  'Use HTTPS outside local development.',
  'Require validated success before fulfillment.'
]

const createExample = `// Run on your backend. Never expose ACME_API_KEY to the browser.
const response = await fetch(
  \`\${process.env.ACME_BASE_URL}/api/v1/projects/\${projectId}/intents\`,
  {
    method: 'POST',
    headers: {
      Authorization: \`Bearer \${process.env.ACME_API_KEY}\`,
      'Idempotency-Key': orderId,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      account: walletAddress,
      transaction: {
        TransactionType: 'Payment',
        Destination: merchantAddress,
        Amount: '25000000'
      },
      sponsorship: { fee: true, reserve: false },
      signing: { mode: 'single', signerCount: 1 }
    })
  }
)

if (!response.ok) throw new Error(await response.text())
const intent = await response.json()`

const signExample = `// Run through your wallet integration in the browser.
// Sign only: do not autofill, mutate, or submit this transaction.
const { signedTransaction } = await wallet.signTransaction({
  network: intent.network,
  transaction: intent.transaction
})

// Send intent.id, intent.grant, and signedTransaction to your backend.`

const authorizeExample = `// Run on your backend after receiving the wallet-signed hex blob.
const authorization = await fetch(
  \`\${process.env.ACME_BASE_URL}/api/v1/intents/\${intentId}/authorize\`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant, signedTransaction })
  }
).then(async response => {
  if (!response.ok) throw new Error(await response.text())
  return response.json()
})

// authorization.state is "submitting". It is not ledger success.`

const pollExample = `// Poll from your backend with an intents:read API key.
const response = await fetch(
  \`\${process.env.ACME_BASE_URL}/api/v1/intents/\${intentId}\`,
  { headers: { Authorization: \`Bearer \${process.env.ACME_API_KEY}\` } }
)
const intent = await response.json()

if (intent.state === 'validated') {
  // Successful validated XRPL outcome.
}`

const copied = ref<string | null>(null)

async function copyCode(id: string, value: string) {
  await navigator.clipboard.writeText(value)
  copied.value = id
  window.setTimeout(() => {
    if (copied.value === id) copied.value = null
  }, 1800)
}
</script>

<template>
  <UContainer class="py-12 sm:py-16">
    <div class="grid gap-10 lg:grid-cols-[240px_minmax(0,1fr)] xl:gap-16">
      <aside class="lg:sticky lg:top-24 lg:self-start">
        <p class="acme-kicker">
          Documentation
        </p>
        <nav
          class="mt-5 grid grid-cols-2 gap-1 text-sm sm:grid-cols-4 lg:grid-cols-1"
          aria-label="Documentation sections"
        >
          <a
            v-for="item in navigation"
            :key="item.id"
            :href="`#${item.id}`"
            class="rounded-lg px-3 py-2 font-medium text-[#62789C] transition hover:bg-[#EDF4FF] hover:text-[#0A3DFF] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3DFF]"
          >{{ item.label }}</a>
        </nav>
        <div class="mt-6 rounded-2xl border border-[#C7DAF7] bg-white p-4 text-sm leading-6 text-[#62789C]">
          <p class="font-semibold text-[#10244A]">
            Current network
          </p>
          <p class="mt-1">
            Devnet · network ID 2
          </p>
          <p class="mt-2 text-xs">
            Devnet is experimental and may reset.
          </p>
        </div>
      </aside>

      <article class="min-w-0 max-w-5xl">
        <section
          id="overview"
          class="scroll-mt-24"
        >
          <p class="acme-kicker">
            Developer guide
          </p>
          <h1 class="mt-3 max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl">
            Add XRPL sponsorship without custody.
          </h1>
          <p class="mt-5 max-w-3xl text-lg leading-8 text-[#62789C]">
            ACME prepares a bounded transaction, verifies the user's wallet signature, adds the sponsor signature server-side, submits the final bytes, and waits for validated-ledger finality. It never handles the user's private key.
          </p>

          <div class="mt-8 grid gap-4 md:grid-cols-2">
            <div class="acme-card p-6">
              <div class="flex items-center gap-3">
                <span class="flex size-10 items-center justify-center rounded-xl bg-[#DCEBFF] text-[#0A3DFF]">
                  <UIcon
                    name="i-lucide-blocks"
                    class="size-5"
                  />
                </span>
                <div>
                  <p class="font-semibold">
                    xrpl-connect
                  </p>
                  <p class="text-xs font-semibold uppercase tracking-wide text-[#0A3DFF]">
                    Target abstraction
                  </p>
                </div>
              </div>
              <p class="mt-4 leading-7 text-[#62789C]">
                The open-source adapter will own wallet selection, signing handoff, authorization, and polling. It is not implemented yet, so no fictional package API is shown here.
              </p>
            </div>
            <div class="acme-card border-[#9FC4FF] p-6 ring-2 ring-[#DCEBFF]">
              <div class="flex items-center gap-3">
                <span class="flex size-10 items-center justify-center rounded-xl bg-[#0A3DFF] text-white">
                  <UIcon
                    name="i-lucide-code-2"
                    class="size-5"
                  />
                </span>
                <div>
                  <p class="font-semibold">
                    Direct REST API
                  </p>
                  <p class="text-xs font-semibold uppercase tracking-wide text-[#0A3DFF]">
                    Available now
                  </p>
                </div>
              </div>
              <p class="mt-4 leading-7 text-[#62789C]">
                Integrate any compatible XRPL wallet through your own backend. The complete lifecycle and contract are documented below.
              </p>
            </div>
          </div>
        </section>

        <section
          id="flow"
          class="scroll-mt-24 pt-16"
        >
          <p class="acme-kicker">
            Trust boundaries
          </p>
          <h2 class="mt-2 text-3xl font-semibold">
            How sponsorship works
          </h2>
          <div class="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <div
              v-for="(step, index) in steps"
              :key="step.title"
              class="acme-card p-5"
            >
              <div class="flex items-center justify-between">
                <UIcon
                  :name="step.icon"
                  class="size-6 text-[#0A3DFF]"
                />
                <span class="font-mono text-xs text-[#8CA1C3]">0{{ index + 1 }}</span>
              </div>
              <h3 class="mt-4 font-semibold">
                {{ step.title }}
              </h3>
              <p class="mt-2 text-sm leading-6 text-[#62789C]">
                {{ step.text }}
              </p>
            </div>
          </div>
          <UAlert
            class="mt-6"
            color="warning"
            variant="subtle"
            icon="i-lucide-triangle-alert"
            title="The wallet signs first"
            description="The wallet must sign the exact prepared transaction without broadcasting it. ACME adds SponsorSignature afterward, which changes the final serialized blob and transaction ID."
          />
        </section>

        <section
          id="direct-api"
          class="scroll-mt-24 pt-16"
        >
          <p class="acme-kicker">
            Direct integration
          </p>
          <h2 class="mt-2 text-3xl font-semibold">
            1. Create the intent on your backend
          </h2>
          <p class="mt-4 max-w-3xl leading-7 text-[#62789C]">
            Create a scoped key in the developer console. Keep it server-side, use one stable <code>Idempotency-Key</code> per logical operation, and send only business transaction fields. ACME owns account, fee, sequence, deadline, sponsor, sponsor flags, and signing fields.
          </p>
          <div class="relative mt-6 overflow-hidden rounded-2xl bg-[#10244A]">
            <div class="flex items-center justify-between border-b border-white/10 px-5 py-3 text-xs text-blue-100">
              <span>backend.ts</span>
              <UButton
                size="xs"
                color="neutral"
                variant="ghost"
                :icon="copied === 'create' ? 'i-lucide-check' : 'i-lucide-copy'"
                :label="copied === 'create' ? 'Copied' : 'Copy'"
                @click="copyCode('create', createExample)"
              />
            </div>
            <pre class="overflow-x-auto p-6 text-sm leading-6 text-blue-50"><code>{{ createExample }}</code></pre>
          </div>
        </section>

        <section
          id="signing"
          class="scroll-mt-24 pt-16"
        >
          <h2 class="text-3xl font-semibold">
            2. Return a signed hexadecimal blob
          </h2>
          <p class="mt-4 max-w-3xl leading-7 text-[#62789C]">
            The wallet adapter must understand the draft Sponsor fields using the exact <code>definitionsHash</code> returned by ACME. It must return a complete signed transaction blob—not only a signature or transaction JSON.
          </p>
          <div class="relative mt-6 overflow-hidden rounded-2xl bg-[#10244A]">
            <div class="flex items-center justify-between border-b border-white/10 px-5 py-3 text-xs text-blue-100">
              <span>browser.ts</span>
              <UButton
                size="xs"
                color="neutral"
                variant="ghost"
                :icon="copied === 'sign' ? 'i-lucide-check' : 'i-lucide-copy'"
                :label="copied === 'sign' ? 'Copied' : 'Copy'"
                @click="copyCode('sign', signExample)"
              />
            </div>
            <pre class="overflow-x-auto p-6 text-sm leading-6 text-blue-50"><code>{{ signExample }}</code></pre>
          </div>
          <div class="mt-6 grid gap-4 sm:grid-cols-2">
            <div class="rounded-2xl border border-[#C7DAF7] bg-white p-5">
              <p class="font-semibold text-[#10244A]">
                Single signing
              </p>
              <p class="mt-2 text-sm leading-6 text-[#62789C]">
                The blob contains <code>SigningPubKey</code> and <code>TxnSignature</code> from the wallet's ledger-authorized master or regular key.
              </p>
            </div>
            <div class="rounded-2xl border border-[#C7DAF7] bg-white p-5">
              <p class="font-semibold text-[#10244A]">
                Multisigning
              </p>
              <p class="mt-2 text-sm leading-6 text-[#62789C]">
                Use <code>SigningPubKey: ""</code> and a complete <code>Signers</code> array that reaches the validated signer-list quorum.
              </p>
            </div>
          </div>
        </section>

        <section class="scroll-mt-24 pt-16">
          <h2 class="text-3xl font-semibold">
            3. Exchange the grant for authorization
          </h2>
          <p class="mt-4 max-w-3xl leading-7 text-[#62789C]">
            Send the signed blob to your own backend and forward it to ACME with the short-lived, transaction-bound grant. ACME APIs do not enable cross-origin browser calls by default, so use this backend-for-frontend path.
          </p>
          <div class="relative mt-6 overflow-hidden rounded-2xl bg-[#10244A]">
            <div class="flex items-center justify-between border-b border-white/10 px-5 py-3 text-xs text-blue-100">
              <span>authorize.ts</span>
              <UButton
                size="xs"
                color="neutral"
                variant="ghost"
                :icon="copied === 'authorize' ? 'i-lucide-check' : 'i-lucide-copy'"
                :label="copied === 'authorize' ? 'Copied' : 'Copy'"
                @click="copyCode('authorize', authorizeExample)"
              />
            </div>
            <pre class="overflow-x-auto p-6 text-sm leading-6 text-blue-50"><code>{{ authorizeExample }}</code></pre>
          </div>
        </section>

        <section
          id="finality"
          class="scroll-mt-24 pt-16"
        >
          <h2 class="text-3xl font-semibold">
            4. Poll for a successful validated outcome
          </h2>
          <p class="mt-4 max-w-3xl leading-7 text-[#62789C]">
            <code>202 Accepted</code> only means ACME persisted the sponsor-signed transaction and queued submission. Poll from your backend with an <code>intents:read</code> key. Only <code>validated</code> means the XRPL outcome was both validated and successful.
          </p>
          <div class="relative mt-6 overflow-hidden rounded-2xl bg-[#10244A]">
            <div class="flex items-center justify-between border-b border-white/10 px-5 py-3 text-xs text-blue-100">
              <span>poll.ts</span>
              <UButton
                size="xs"
                color="neutral"
                variant="ghost"
                :icon="copied === 'poll' ? 'i-lucide-check' : 'i-lucide-copy'"
                :label="copied === 'poll' ? 'Copied' : 'Copy'"
                @click="copyCode('poll', pollExample)"
              />
            </div>
            <pre class="overflow-x-auto p-6 text-sm leading-6 text-blue-50"><code>{{ pollExample }}</code></pre>
          </div>
          <div class="mt-6 divide-y divide-[#DFE9F7] overflow-hidden rounded-2xl border border-[#C7DAF7] bg-white">
            <div
              v-for="item in terminalStates"
              :key="item.state"
              class="grid gap-2 px-5 py-4 sm:grid-cols-[150px_1fr] sm:items-center"
            >
              <IntentStatus :status="item.state" />
              <p class="text-sm leading-6 text-[#62789C]">
                {{ item.action }}
              </p>
            </div>
          </div>
        </section>

        <section
          id="reference"
          class="scroll-mt-24 pt-16"
        >
          <p class="acme-kicker">
            HTTP reference
          </p>
          <h2 class="mt-2 text-3xl font-semibold">
            Public API surface
          </h2>
          <div class="mt-6 overflow-hidden rounded-2xl border border-[#C7DAF7] bg-white">
            <div
              v-for="endpoint in endpoints"
              :key="`${endpoint.method}:${endpoint.path}`"
              class="grid gap-3 border-b border-[#DFE9F7] px-5 py-5 last:border-b-0 lg:grid-cols-[70px_minmax(0,1fr)_130px_minmax(0,1fr)] lg:items-center"
            >
              <span class="w-fit rounded-md bg-[#EDF4FF] px-2 py-1 font-mono text-xs font-bold text-[#0A3DFF]">{{ endpoint.method }}</span>
              <code class="break-all text-sm text-[#10244A]">{{ endpoint.path }}</code>
              <span class="text-xs font-semibold text-[#62789C]">{{ endpoint.scope }}</span>
              <p class="text-sm leading-6 text-[#62789C]">
                {{ endpoint.result }}
              </p>
            </div>
          </div>

          <h3 class="mt-10 text-xl font-semibold">
            Error handling
          </h3>
          <div class="mt-4 grid gap-3 sm:grid-cols-2">
            <div class="rounded-xl border border-[#C7DAF7] bg-white p-4 text-sm leading-6 text-[#62789C]">
              <strong class="text-[#10244A]">400</strong> · Invalid fields, managed fields, malformed blob, or envelope mismatch.
            </div>
            <div class="rounded-xl border border-[#C7DAF7] bg-white p-4 text-sm leading-6 text-[#62789C]">
              <strong class="text-[#10244A]">401 / 403</strong> · Missing key, invalid scope, policy denial, or invalid/consumed grant.
            </div>
            <div class="rounded-xl border border-[#C7DAF7] bg-white p-4 text-sm leading-6 text-[#62789C]">
              <strong class="text-[#10244A]">409</strong> · Idempotency conflict, stale sequence/deadline/target, pause, or insufficient capacity.
            </div>
            <div class="rounded-xl border border-[#C7DAF7] bg-white p-4 text-sm leading-6 text-[#62789C]">
              <strong class="text-[#10244A]">429 / 503</strong> · Wallet rate limit or global sponsorship pause.
            </div>
          </div>
        </section>

        <section
          id="existing"
          class="scroll-mt-24 pt-16"
        >
          <p class="acme-kicker">
            Reserve migration
          </p>
          <h2 class="mt-2 text-3xl font-semibold">
            Sponsoring an existing wallet
          </h2>
          <p class="mt-4 max-w-3xl leading-7 text-[#62789C]">
            Existing wallets can use fee sponsorship immediately. Existing account and object reserves require a separate <code>SponsorshipTransfer</code> for every eligible target. Sponsoring an <code>AccountRoot</code> never retroactively sponsors its trust lines, offers, tickets, NFTs, or other objects.
          </p>
          <ol class="mt-6 grid gap-4 sm:grid-cols-2">
            <li class="acme-card p-5">
              <span class="text-xs font-bold text-[#0A3DFF]">01 · INSPECT</span>
              <p class="mt-2 text-sm leading-6 text-[#62789C]">
                Read the account and its owner objects from one pinned validated ledger.
              </p>
            </li>
            <li class="acme-card p-5">
              <span class="text-xs font-bold text-[#0A3DFF]">02 · PREPARE</span>
              <p class="mt-2 text-sm leading-6 text-[#62789C]">
                Prepare one fresh transfer for one eligible account or object target.
              </p>
            </li>
            <li class="acme-card p-5">
              <span class="text-xs font-bold text-[#0A3DFF]">03 · AUTHORIZE</span>
              <p class="mt-2 text-sm leading-6 text-[#62789C]">
                The owning wallet signs the exact transfer; ACME verifies control and co-signs.
              </p>
            </li>
            <li class="acme-card p-5">
              <span class="text-xs font-bold text-[#0A3DFF]">04 · RECONCILE</span>
              <p class="mt-2 text-sm leading-6 text-[#62789C]">
                Confirm ACME in the validated object sponsor field before moving to the next target.
              </p>
            </li>
          </ol>
          <UAlert
            class="mt-6"
            color="primary"
            variant="subtle"
            icon="i-lucide-info"
            title="Current API boundary"
            description="The public API exposes read-only reserve inspection. Durable transfer preparation and progress are currently handled by the authenticated Reserve migration console. Trust-line migration remains disabled because its two sides can carry independent sponsors."
          />
        </section>

        <section
          id="security"
          class="scroll-mt-24 pt-16"
        >
          <p class="acme-kicker">
            Deployment checklist
          </p>
          <h2 class="mt-2 text-3xl font-semibold">
            Security requirements
          </h2>
          <ul class="mt-6 grid gap-3 text-[#62789C] sm:grid-cols-2">
            <li
              v-for="requirement in securityRequirements"
              :key="requirement"
              class="flex gap-3 rounded-xl border border-[#C7DAF7] bg-white p-4 text-sm leading-6"
            >
              <UIcon
                name="i-lucide-check"
                class="mt-1 size-4 shrink-0 text-[#0A3DFF]"
              />
              {{ requirement }}
            </li>
          </ul>
        </section>
      </article>
    </div>
  </UContainer>
</template>
