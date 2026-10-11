# Lessons

- Use product language in the console rather than pilot branding. Project navigation must reflect the selected project throughout the app, and persistent status decorations should earn their space.

- Keep the login form introduction to the requested direct heading; avoid repeated console labels and sponsorship descriptions around an already branded form.

- Keep shared hero artwork on the same side across landing and authentication pages to preserve visual continuity when users navigate.

- For a light-only design, disable automatic framework color-mode switching and set native controls to light. Verify with both a dark OS preference and a saved dark theme so framework tokens cannot conflict with custom light surfaces.

- Treat draft amendment documents as design input, not proof of network availability. Discover live capabilities and fail closed before signing.
- Keep fee spend, pending reserve exposure, and validated locked reserve capital separate in protocol, database, API, and UI models.
- Existing account sponsorship never implies retroactive sponsorship of owned ledger objects; inventory and migrate eligible objects explicitly.
- Generate and validate authentication tables against the exact installed Better Auth version; its adapter schema can evolve independently of the application's domain schema.
- While the product is greenfield and the local database is disposable, squash schema corrections into the baseline migration instead of accumulating compatibility migrations.
- Never represent production state with fabricated metrics, health, capabilities, balances, or transaction outcomes. Every production UI surface must come from an authenticated backend API; test fixtures belong in isolated test infrastructure only.
- Use the live network's `server_definitions` and amendment state as the protocol authority for draft amendments. Generated constants copied from an XLS draft can diverge from the implementation deployed on Devnet.
- The default development network is XRPL Devnet and transaction success means a submitted, validated ledger transaction—not a locally simulated state transition.
- Inspect live RPC response shapes instead of inferring field units from names or documentation variants; Devnet `server_state` currently reports `base_fee`, `reserve_base`, and `reserve_inc` directly in drops.
- Exercise HTTP handlers through JSON serialization in tests and smoke checks so database `bigint` values cannot silently escape API response contracts.
- Treat a `submit` result as provisional. Finalize an intent only from a validated transaction, or expire it only after the ledger range reports `searched_all: true`.
- Reconcile reserve obligations periodically from the ledger because an object can be deleted or its sponsorship transferred outside ACME.
- Nuxt UI select items must never use an empty-string value; represent an unfiltered choice with an explicit sentinel and translate it to an omitted API parameter at the request boundary.
- Use `UCheckboxGroup` for array-valued selections. Binding the same array directly to several `UCheckbox` components makes each checkbox treat the full array as its scalar checked state, coupling every control and invalidating form guards.
- Clipboard actions must expose both success and failure feedback. Update the triggering control immediately, announce the result for assistive technology, catch clipboard permission errors, and reset transient state predictably.
- Transaction history APIs must expose the persisted submission hash and network. Explorer links should be network-aware, validate the hash before rendering, use real anchor semantics for keyboard access, and leave pre-submission rows non-interactive.
- Never document a planned wallet abstraction as an implemented SDK API. Describe the exact HTTP and signed-artifact contract first, label future adapters clearly, and account for wallet codecs that cannot yet serialize draft amendment fields.
- Public navigation should expose one session-aware console action rather than simultaneous Sign in and Open console buttons. Preserve the protected destination in the guest redirect and render auth-varying pages per request to avoid a misleading first paint.
- Marketing composition does not justify fabricated or publicly disclosed tenant metrics. Use clearly labeled examples for conceptual UI and non-sensitive live network data for factual public statistics.
- A hero asset is not visually verified until its full focal subject survives the target viewport, container aspect ratio, and foreground overlays; decouple decorative image height from variable content when lower cards would otherwise shift the subject out of view.
- When the user supplies a final visual asset, use that asset directly and remove approximation filters or overlays that alter its intended composition.
- Size overlapping hero cards against the artwork's full subject bounds, not merely the available container width; a correct crop still fails if foreground UI covers the focal object.
- When a visual adjustment is specified as a percentage, apply it to the current rendered dimension explicitly and record the resulting target rather than estimating by eye.
- Transaction examples must follow the actual XRPL field model; use the sponsoring account for an `NFTokenMint` counterpart instead of inventing a destination the transaction type does not have.
