CREATE TABLE "sponsor_treasuries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"network" "network" NOT NULL,
	"address" text NOT NULL,
	"signer_provider" text DEFAULT 'local' NOT NULL,
	"signer_key_reference" text NOT NULL,
	"capabilities" jsonb NOT NULL,
	"status" "project_status" DEFAULT 'active' NOT NULL,
	"safety_buffer_drops" bigint DEFAULT 0 NOT NULL,
	"observed_balance_drops" bigint DEFAULT 0 NOT NULL,
	"reconciled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sponsor_accounts" ADD COLUMN "treasury_id" uuid;
--> statement-breakpoint
ALTER TABLE "funding_balances" ADD COLUMN "treasury_id" uuid;
--> statement-breakpoint
ALTER TABLE "funding_ledger_entries" ADD COLUMN "treasury_id" uuid;
--> statement-breakpoint
ALTER TABLE "reserve_obligations" ADD COLUMN "treasury_id" uuid;
--> statement-breakpoint
ALTER TABLE "sponsorship_intents" ADD COLUMN "quota_period_start" timestamp with time zone;
--> statement-breakpoint
INSERT INTO "sponsor_treasuries" ("network", "address", "signer_provider", "signer_key_reference", "capabilities", "status", "safety_buffer_drops", "observed_balance_drops", "reconciled_at", "created_at")
SELECT DISTINCT ON ("network", "address") "network", "address", "signer_provider", "signer_key_reference", "capabilities", "status", "safety_buffer_drops", "observed_balance_drops", "reconciled_at", "created_at"
FROM "sponsor_accounts"
ORDER BY "network", "address", "reconciled_at" DESC NULLS LAST, "created_at", "id";
--> statement-breakpoint
UPDATE "sponsor_accounts" AS account
SET "treasury_id" = treasury."id"
FROM "sponsor_treasuries" AS treasury
WHERE treasury."network" = account."network" AND treasury."address" = account."address";
--> statement-breakpoint
CREATE TABLE "project_sponsor_accounts" (
	"project_id" uuid NOT NULL,
	"sponsor_account_id" uuid NOT NULL,
	"network" "network" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_sponsor_accounts_project_id_sponsor_account_id" PRIMARY KEY("project_id", "sponsor_account_id")
);
--> statement-breakpoint
INSERT INTO "project_sponsor_accounts" ("project_id", "sponsor_account_id", "network")
SELECT "project_id", "id", "network" FROM "sponsor_accounts";
--> statement-breakpoint
ALTER TABLE "project_sponsor_accounts" ADD CONSTRAINT "project_sponsor_accounts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "project_sponsor_accounts" ADD CONSTRAINT "project_sponsor_accounts_sponsor_account_id_sponsor_accounts_id_fk" FOREIGN KEY ("sponsor_account_id") REFERENCES "public"."sponsor_accounts"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "project_sponsor_network_unique" ON "project_sponsor_accounts" USING btree ("project_id", "network");
--> statement-breakpoint
UPDATE "sponsor_treasuries" AS treasury
SET "safety_buffer_drops" = source."safety_buffer_drops",
	"observed_balance_drops" = source."observed_balance_drops",
	"reconciled_at" = source."reconciled_at"
FROM (
	SELECT DISTINCT ON ("network", "address") "network", "address", "safety_buffer_drops", "observed_balance_drops", "reconciled_at"
	FROM "sponsor_accounts"
	ORDER BY "network", "address", "reconciled_at" DESC NULLS LAST, "created_at" DESC, "id" DESC
) AS source
WHERE source."network" = treasury."network" AND source."address" = treasury."address";
--> statement-breakpoint
UPDATE "funding_balances" AS balance
SET "treasury_id" = account."treasury_id"
FROM "sponsor_accounts" AS account
WHERE account."id" = balance."sponsor_account_id";
--> statement-breakpoint
WITH totals AS (
	SELECT "treasury_id", sum("pending_fee_drops") AS pending_fee_drops, sum("captured_fee_drops") AS captured_fee_drops, sum("pending_reserve_drops") AS pending_reserve_drops, sum("locked_reserve_drops") AS locked_reserve_drops
	FROM "funding_balances"
	GROUP BY "treasury_id"
), keepers AS (
	SELECT DISTINCT ON ("treasury_id") "treasury_id", "sponsor_account_id"
	FROM "funding_balances"
	ORDER BY "treasury_id", "sponsor_account_id"
)
UPDATE "funding_balances" AS balance
SET "pending_fee_drops" = totals.pending_fee_drops,
	"captured_fee_drops" = totals.captured_fee_drops,
	"pending_reserve_drops" = totals.pending_reserve_drops,
	"locked_reserve_drops" = totals.locked_reserve_drops,
	"treasury_id" = totals."treasury_id",
	"updated_at" = now()
FROM totals
JOIN keepers ON keepers."treasury_id" = totals."treasury_id"
WHERE balance."sponsor_account_id" = keepers."sponsor_account_id";
--> statement-breakpoint
WITH keepers AS (
	SELECT DISTINCT ON ("treasury_id") "treasury_id", "sponsor_account_id"
	FROM "funding_balances"
	ORDER BY "treasury_id", "sponsor_account_id"
)
DELETE FROM "funding_balances" AS balance
USING keepers
WHERE balance."treasury_id" = keepers."treasury_id" AND balance."sponsor_account_id" <> keepers."sponsor_account_id";
--> statement-breakpoint
UPDATE "funding_ledger_entries" AS entry
SET "treasury_id" = account."treasury_id"
FROM "sponsor_accounts" AS account
WHERE account."id" = entry."sponsor_account_id";
--> statement-breakpoint
UPDATE "reserve_obligations" AS obligation
SET "treasury_id" = account."treasury_id"
FROM "sponsor_accounts" AS account
WHERE account."id" = obligation."sponsor_account_id";
--> statement-breakpoint
ALTER TABLE "sponsor_accounts" ALTER COLUMN "treasury_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "funding_balances" ALTER COLUMN "treasury_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "funding_ledger_entries" ALTER COLUMN "treasury_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "reserve_obligations" ALTER COLUMN "treasury_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "sponsor_accounts" ADD CONSTRAINT "sponsor_accounts_treasury_id_sponsor_treasuries_id_fk" FOREIGN KEY ("treasury_id") REFERENCES "public"."sponsor_treasuries"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "funding_balances" ADD CONSTRAINT "funding_balances_treasury_id_sponsor_treasuries_id_fk" FOREIGN KEY ("treasury_id") REFERENCES "public"."sponsor_treasuries"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "funding_ledger_entries" ADD CONSTRAINT "funding_ledger_entries_treasury_id_sponsor_treasuries_id_fk" FOREIGN KEY ("treasury_id") REFERENCES "public"."sponsor_treasuries"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "reserve_obligations" ADD CONSTRAINT "reserve_obligations_treasury_id_sponsor_treasuries_id_fk" FOREIGN KEY ("treasury_id") REFERENCES "public"."sponsor_treasuries"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "sponsor_treasury_network_address_unique" ON "sponsor_treasuries" USING btree ("network", "address");
--> statement-breakpoint
CREATE UNIQUE INDEX "funding_balance_treasury_unique" ON "funding_balances" USING btree ("treasury_id");
--> statement-breakpoint
WITH duplicates AS (
	SELECT "id", "idempotency_key", row_number() OVER (PARTITION BY "treasury_id", "idempotency_key" ORDER BY "created_at", "id") AS row_number
	FROM "funding_ledger_entries"
)
UPDATE "funding_ledger_entries" AS entry
SET "idempotency_key" = duplicates."idempotency_key" || ':migrated:' || duplicates."id"
FROM duplicates
WHERE duplicates."id" = entry."id" AND duplicates.row_number > 1;
--> statement-breakpoint
CREATE UNIQUE INDEX "funding_treasury_entry_idempotency_unique" ON "funding_ledger_entries" USING btree ("treasury_id", "idempotency_key");
--> statement-breakpoint
DROP INDEX IF EXISTS "reserve_active_object_unique";
--> statement-breakpoint
CREATE INDEX "reserve_active_object_treasury_idx" ON "reserve_obligations" USING btree ("treasury_id", "owner_address", "object_id");
--> statement-breakpoint
CREATE TABLE "project_funding_budgets" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"fee_budget_drops" bigint DEFAULT 1000000 NOT NULL,
	"reserve_budget_drops" bigint DEFAULT 100000000 NOT NULL,
	"wallet_fee_quota_drops" bigint DEFAULT 100000 NOT NULL,
	"wallet_reserve_quota_drops" bigint DEFAULT 10000000 NOT NULL,
	"quota_period_seconds" integer DEFAULT 86400 NOT NULL,
	"fee_reserved_drops" bigint DEFAULT 0 NOT NULL,
	"fee_spent_drops" bigint DEFAULT 0 NOT NULL,
	"reserve_reserved_drops" bigint DEFAULT 0 NOT NULL,
	"reserve_exposure_drops" bigint DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_funding_quotas" (
	"project_id" uuid NOT NULL,
	"account_address" text NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"fee_reserved_drops" bigint DEFAULT 0 NOT NULL,
	"fee_spent_drops" bigint DEFAULT 0 NOT NULL,
	"reserve_reserved_drops" bigint DEFAULT 0 NOT NULL,
	"reserve_exposure_drops" bigint DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_funding_quotas_project_id_account_address_period_start" PRIMARY KEY("project_id","account_address","period_start")
);
--> statement-breakpoint
ALTER TABLE "project_funding_budgets" ADD CONSTRAINT "project_funding_budgets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "project_funding_quotas" ADD CONSTRAINT "project_funding_quotas_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
INSERT INTO "project_funding_budgets" ("project_id") SELECT "id" FROM "projects" ON CONFLICT ("project_id") DO NOTHING;
--> statement-breakpoint
-- Preserve reservations and completed spend already represented by the intent
-- history when introducing project and wallet counters. Awaiting signatures
-- have no funding reservation yet; validated reserve obligations remain
-- exposure until their ledger objects stop naming this treasury.
UPDATE "sponsorship_intents"
SET "quota_period_start" = to_timestamp(floor(extract(epoch FROM COALESCE("updated_at", "created_at")) / 86400) * 86400)
WHERE "quota_period_start" IS NULL
  AND "state" IN ('submitting', 'submitted', 'validated');
--> statement-breakpoint
WITH active_obligations AS (
	SELECT "intent_id", sum("reserve_drops") AS reserve_exposure_drops
	FROM "reserve_obligations"
	WHERE "state" = 'active'
	GROUP BY "intent_id"
), intent_usage AS (
	SELECT
		i."project_id",
		i."account_address",
		i."quota_period_start",
		sum(CASE WHEN i."state" IN ('submitting', 'submitted') THEN i."estimated_fee_drops" ELSE 0 END) AS fee_reserved_drops,
		sum(CASE WHEN i."state" = 'validated' THEN COALESCE(s."actual_fee_drops", i."estimated_fee_drops") ELSE 0 END) AS fee_spent_drops,
		sum(CASE WHEN i."state" IN ('submitting', 'submitted') THEN i."estimated_reserve_drops" ELSE 0 END) AS reserve_reserved_drops,
		sum(CASE WHEN i."state" IN ('submitting', 'submitted') THEN i."estimated_reserve_drops" ELSE 0 END) + sum(CASE WHEN i."state" = 'validated' THEN COALESCE(o.reserve_exposure_drops, 0) ELSE 0 END) AS reserve_exposure_drops
	FROM "sponsorship_intents" AS i
	LEFT JOIN "submissions" AS s ON s."intent_id" = i."id" AND s."attempt" = 1
	LEFT JOIN active_obligations AS o ON o."intent_id" = i."id"
	WHERE i."quota_period_start" IS NOT NULL
	GROUP BY i."project_id", i."account_address", i."quota_period_start"
)
INSERT INTO "project_funding_quotas" ("project_id", "account_address", "period_start", "fee_reserved_drops", "fee_spent_drops", "reserve_reserved_drops", "reserve_exposure_drops")
SELECT "project_id", "account_address", "quota_period_start", "fee_reserved_drops", "fee_spent_drops", "reserve_reserved_drops", "reserve_exposure_drops"
FROM intent_usage
ON CONFLICT ("project_id", "account_address", "period_start") DO UPDATE SET
	"fee_reserved_drops" = EXCLUDED."fee_reserved_drops",
	"fee_spent_drops" = EXCLUDED."fee_spent_drops",
	"reserve_reserved_drops" = EXCLUDED."reserve_reserved_drops",
	"reserve_exposure_drops" = EXCLUDED."reserve_exposure_drops";
--> statement-breakpoint
WITH usage AS (
	SELECT
		"project_id",
		sum("fee_reserved_drops") AS fee_reserved_drops,
		sum("fee_spent_drops") AS fee_spent_drops,
		sum("reserve_reserved_drops") AS reserve_reserved_drops,
		sum("reserve_exposure_drops") AS reserve_exposure_drops
	FROM "project_funding_quotas"
	GROUP BY "project_id"
)
UPDATE "project_funding_budgets" AS budget
SET "fee_reserved_drops" = COALESCE(usage.fee_reserved_drops, 0),
	"fee_spent_drops" = COALESCE(usage.fee_spent_drops, 0),
	"reserve_reserved_drops" = COALESCE(usage.reserve_reserved_drops, 0),
	"reserve_exposure_drops" = COALESCE(usage.reserve_exposure_drops, 0)
FROM usage
WHERE usage."project_id" = budget."project_id";
