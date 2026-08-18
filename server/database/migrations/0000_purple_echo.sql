CREATE TYPE "public"."funding_entry_type" AS ENUM('credit', 'reservation', 'capture', 'release', 'reconciliation', 'manual_adjustment');--> statement-breakpoint
CREATE TYPE "public"."intent_state" AS ENUM('created', 'awaiting_user_signature', 'user_signature_received', 'verified', 'awaiting_sponsor_signature', 'submitting', 'submitted', 'validated', 'failed', 'rejected', 'expired', 'cancelled', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."member_role" AS ENUM('owner', 'admin', 'developer', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."network" AS ENUM('mainnet', 'testnet', 'devnet');--> statement-breakpoint
CREATE TYPE "public"."policy_status" AS ENUM('draft', 'active', 'paused', 'archived');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('active', 'paused', 'archived');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"issuer" text NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"secret_hash" text NOT NULL,
	"scopes" text[] NOT NULL,
	"expires_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"project_id" uuid,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text NOT NULL,
	"result" text NOT NULL,
	"request_id" text NOT NULL,
	"metadata" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "funding_balances" (
	"sponsor_account_id" uuid PRIMARY KEY NOT NULL,
	"pending_fee_drops" bigint DEFAULT 0 NOT NULL,
	"captured_fee_drops" bigint DEFAULT 0 NOT NULL,
	"pending_reserve_drops" bigint DEFAULT 0 NOT NULL,
	"locked_reserve_drops" bigint DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "funding_ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sponsor_account_id" uuid NOT NULL,
	"intent_id" uuid,
	"type" "funding_entry_type" NOT NULL,
	"fee_drops" bigint DEFAULT 0 NOT NULL,
	"reserve_drops" bigint DEFAULT 0 NOT NULL,
	"idempotency_key" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intent_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"intent_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"from_state" "intent_state",
	"to_state" "intent_state" NOT NULL,
	"actor" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "network_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"network" "network" NOT NULL,
	"network_id" integer NOT NULL,
	"definitions_hash" text NOT NULL,
	"amendment_id" text NOT NULL,
	"server_version" text NOT NULL,
	"rpc_url" text NOT NULL,
	"ledger_index" bigint NOT NULL,
	"capabilities" jsonb NOT NULL,
	"base_fee_drops" bigint NOT NULL,
	"account_reserve_drops" bigint NOT NULL,
	"object_reserve_drops" bigint NOT NULL,
	"endpoint_healthy" boolean NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" "member_role" DEFAULT 'developer' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"status" "project_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" text,
	"lock_version" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"dead_lettered_at" timestamp with time zone,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_controls" (
	"key" text PRIMARY KEY NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"reason" text,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"public_id" text NOT NULL,
	"environment" text DEFAULT 'development' NOT NULL,
	"network" "network" NOT NULL,
	"rpc_url" text NOT NULL,
	"status" "project_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_public_id_unique" UNIQUE("public_id")
);
--> statement-breakpoint
CREATE TABLE "reserve_migration_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"sponsor_account_id" uuid NOT NULL,
	"account_address" text NOT NULL,
	"network" "network" NOT NULL,
	"network_id" integer NOT NULL,
	"definitions_hash" text NOT NULL,
	"inspection_ledger_index" bigint NOT NULL,
	"inspection_ledger_hash" text NOT NULL,
	"state" text DEFAULT 'inspected' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reserve_migration_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"target_key" text NOT NULL,
	"object_id" text,
	"object_type" text NOT NULL,
	"trustline_side" text,
	"owner_address" text NOT NULL,
	"observed_sponsor" text,
	"snapshot_hash" text NOT NULL,
	"reserve_units" integer DEFAULT 1 NOT NULL,
	"estimated_reserve_drops" bigint NOT NULL,
	"classification" text NOT NULL,
	"state" text DEFAULT 'available' NOT NULL,
	"intent_id" uuid,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reserve_obligations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sponsor_account_id" uuid NOT NULL,
	"intent_id" uuid NOT NULL,
	"owner_address" text NOT NULL,
	"object_id" text,
	"object_type" text NOT NULL,
	"trustline_side" text,
	"reserve_drops" bigint NOT NULL,
	"state" text NOT NULL,
	"activated_ledger_index" bigint,
	"released_ledger_index" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"impersonated_by" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "sponsor_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
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
CREATE TABLE "sponsorship_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"intent_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"audience" text NOT NULL,
	"account_address" text NOT NULL,
	"canonical_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sponsorship_grants_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "sponsorship_intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"sponsor_account_id" uuid,
	"policy_id" uuid,
	"account_address" text NOT NULL,
	"network" "network" NOT NULL,
	"network_id" integer NOT NULL,
	"definitions_hash" text NOT NULL,
	"mode" text NOT NULL,
	"canonical_transaction" jsonb NOT NULL,
	"canonical_hash" text NOT NULL,
	"prepared_ledger_index" bigint NOT NULL,
	"user_signed_blob" text,
	"sponsor_signing_hash" text,
	"request_hash" text NOT NULL,
	"policy_snapshot" jsonb NOT NULL,
	"estimated_fee_drops" bigint DEFAULT 0 NOT NULL,
	"estimated_reserve_drops" bigint DEFAULT 0 NOT NULL,
	"idempotency_key" text NOT NULL,
	"correlation_id" text NOT NULL,
	"state" "intent_state" DEFAULT 'created' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sponsorship_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"version" integer NOT NULL,
	"status" "policy_status" DEFAULT 'draft' NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"document" jsonb NOT NULL,
	"document_hash" text NOT NULL,
	"published_by" text,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"intent_id" uuid NOT NULL,
	"attempt" integer NOT NULL,
	"signed_blob" text NOT NULL,
	"transaction_hash" text NOT NULL,
	"endpoint" text NOT NULL,
	"engine_result" text,
	"response" jsonb,
	"first_submitted_ledger_index" bigint NOT NULL,
	"actual_fee_drops" bigint,
	"ledger_index" bigint,
	"validated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"intent_id" uuid NOT NULL,
	"charge_type" text NOT NULL,
	"fee_drops" bigint DEFAULT 0 NOT NULL,
	"reserve_drops" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"role" text DEFAULT 'user' NOT NULL,
	"banned" boolean DEFAULT false NOT NULL,
	"ban_reason" text,
	"ban_expires" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worker_heartbeats" (
	"worker_name" text PRIMARY KEY NOT NULL,
	"instance_id" text NOT NULL,
	"status" text NOT NULL,
	"metadata" jsonb NOT NULL,
	"last_heartbeat_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funding_balances" ADD CONSTRAINT "funding_balances_sponsor_account_id_sponsor_accounts_id_fk" FOREIGN KEY ("sponsor_account_id") REFERENCES "public"."sponsor_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funding_ledger_entries" ADD CONSTRAINT "funding_ledger_entries_sponsor_account_id_sponsor_accounts_id_fk" FOREIGN KEY ("sponsor_account_id") REFERENCES "public"."sponsor_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funding_ledger_entries" ADD CONSTRAINT "funding_ledger_entries_intent_id_sponsorship_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."sponsorship_intents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intent_events" ADD CONSTRAINT "intent_events_intent_id_sponsorship_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."sponsorship_intents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network_snapshots" ADD CONSTRAINT "network_snapshots_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_controls" ADD CONSTRAINT "platform_controls_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reserve_migration_plans" ADD CONSTRAINT "reserve_migration_plans_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reserve_migration_plans" ADD CONSTRAINT "reserve_migration_plans_sponsor_account_id_sponsor_accounts_id_fk" FOREIGN KEY ("sponsor_account_id") REFERENCES "public"."sponsor_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reserve_migration_plans" ADD CONSTRAINT "reserve_migration_plans_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reserve_migration_targets" ADD CONSTRAINT "reserve_migration_targets_plan_id_reserve_migration_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."reserve_migration_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reserve_migration_targets" ADD CONSTRAINT "reserve_migration_targets_intent_id_sponsorship_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."sponsorship_intents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reserve_obligations" ADD CONSTRAINT "reserve_obligations_sponsor_account_id_sponsor_accounts_id_fk" FOREIGN KEY ("sponsor_account_id") REFERENCES "public"."sponsor_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reserve_obligations" ADD CONSTRAINT "reserve_obligations_intent_id_sponsorship_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."sponsorship_intents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sponsor_accounts" ADD CONSTRAINT "sponsor_accounts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sponsorship_grants" ADD CONSTRAINT "sponsorship_grants_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sponsorship_grants" ADD CONSTRAINT "sponsorship_grants_intent_id_sponsorship_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."sponsorship_intents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sponsorship_intents" ADD CONSTRAINT "sponsorship_intents_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sponsorship_intents" ADD CONSTRAINT "sponsorship_intents_sponsor_account_id_sponsor_accounts_id_fk" FOREIGN KEY ("sponsor_account_id") REFERENCES "public"."sponsor_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sponsorship_intents" ADD CONSTRAINT "sponsorship_intents_policy_id_sponsorship_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."sponsorship_policies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sponsorship_policies" ADD CONSTRAINT "sponsorship_policies_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sponsorship_policies" ADD CONSTRAINT "sponsorship_policies_published_by_user_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_intent_id_sponsorship_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."sponsorship_intents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_intent_id_sponsorship_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."sponsorship_intents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "account_issuer_unique" ON "account" USING btree ("issuer","account_id");--> statement-breakpoint
CREATE INDEX "api_keys_project_idx" ON "api_keys" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_hash_unique" ON "api_keys" USING btree ("secret_hash");--> statement-breakpoint
CREATE INDEX "audit_org_created_idx" ON "audit_logs" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_created_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "funding_entry_idempotency_unique" ON "funding_ledger_entries" USING btree ("sponsor_account_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "intent_event_version_unique" ON "intent_events" USING btree ("intent_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "network_snapshot_ledger_unique" ON "network_snapshots" USING btree ("project_id","ledger_index");--> statement-breakpoint
CREATE UNIQUE INDEX "membership_org_user_unique" ON "organization_memberships" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "outbox_pending_idx" ON "outbox_events" USING btree ("processed_at","available_at");--> statement-breakpoint
CREATE UNIQUE INDEX "outbox_aggregate_event_unique" ON "outbox_events" USING btree ("aggregate_type","aggregate_id","event_type");--> statement-breakpoint
CREATE INDEX "projects_org_idx" ON "projects" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "reserve_plan_project_idx" ON "reserve_migration_plans" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "reserve_target_plan_key_unique" ON "reserve_migration_targets" USING btree ("plan_id","target_key");--> statement-breakpoint
CREATE UNIQUE INDEX "reserve_target_intent_unique" ON "reserve_migration_targets" USING btree ("intent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reserve_active_object_unique" ON "reserve_obligations" USING btree ("sponsor_account_id","owner_address","object_id");--> statement-breakpoint
CREATE INDEX "reserve_owner_idx" ON "reserve_obligations" USING btree ("owner_address");--> statement-breakpoint
CREATE INDEX "session_user_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sponsor_project_network_unique" ON "sponsor_accounts" USING btree ("project_id","network");--> statement-breakpoint
CREATE INDEX "grant_intent_idx" ON "sponsorship_grants" USING btree ("intent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "intent_project_idempotency_unique" ON "sponsorship_intents" USING btree ("project_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "intent_project_state_idx" ON "sponsorship_intents" USING btree ("project_id","state");--> statement-breakpoint
CREATE INDEX "intent_account_idx" ON "sponsorship_intents" USING btree ("account_address");--> statement-breakpoint
CREATE UNIQUE INDEX "policy_project_name_version_unique" ON "sponsorship_policies" USING btree ("project_id","name","version");--> statement-breakpoint
CREATE UNIQUE INDEX "submission_intent_attempt_unique" ON "submissions" USING btree ("intent_id","attempt");--> statement-breakpoint
CREATE INDEX "submission_tx_hash_idx" ON "submissions" USING btree ("transaction_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "usage_intent_charge_unique" ON "usage_events" USING btree ("intent_id","charge_type");--> statement-breakpoint
CREATE INDEX "usage_project_created_idx" ON "usage_events" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");