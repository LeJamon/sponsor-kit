import { relations, sql } from 'drizzle-orm'
import { bigint, boolean, index, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

export const memberRole = pgEnum('member_role', ['owner', 'admin', 'developer', 'viewer'])
export const projectStatus = pgEnum('project_status', ['active', 'paused', 'archived'])
export const network = pgEnum('network', ['mainnet', 'testnet', 'devnet'])
export const policyStatus = pgEnum('policy_status', ['draft', 'active', 'paused', 'archived'])
export const intentState = pgEnum('intent_state', ['created', 'awaiting_user_signature', 'user_signature_received', 'verified', 'awaiting_sponsor_signature', 'submitting', 'submitted', 'validated', 'failed', 'rejected', 'expired', 'cancelled', 'superseded'])
export const fundingEntryType = pgEnum('funding_entry_type', ['credit', 'reservation', 'capture', 'release', 'reconciliation', 'manual_adjustment'])

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').default(false).notNull(),
  image: text('image'),
  role: text('role').default('user').notNull(),
  banned: boolean('banned').default(false).notNull(),
  banReason: text('ban_reason'),
  banExpires: timestamp('ban_expires', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
})

export const session = pgTable('session', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  token: text('token').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  impersonatedBy: text('impersonated_by'),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' })
}, table => [index('session_user_idx').on(table.userId)])

export const account = pgTable('account', {
  id: text('id').primaryKey(),
  issuer: text('issuer'),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
}, table => [index('account_user_idx').on(table.userId)])

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
}, table => [index('verification_identifier_idx').on(table.identifier)])

export const organizations = pgTable('organizations', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  status: projectStatus('status').default('active').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
})

export const organizationMemberships = pgTable('organization_memberships', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  role: memberRole('role').default('developer').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, table => [uniqueIndex('membership_org_user_unique').on(table.organizationId, table.userId)])

export const projects = pgTable('projects', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  publicId: text('public_id').notNull().unique(),
  environment: text('environment').default('development').notNull(),
  network: network('network').notNull(),
  rpcUrl: text('rpc_url').notNull(),
  status: projectStatus('status').default('active').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
}, table => [index('projects_org_idx').on(table.organizationId)])

export const apiKeys = pgTable('api_keys', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  prefix: text('prefix').notNull(),
  secretHash: text('secret_hash').notNull(),
  scopes: text('scopes').array().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, table => [index('api_keys_project_idx').on(table.projectId), uniqueIndex('api_keys_hash_unique').on(table.secretHash)])

export const sponsorshipPolicies = pgTable('sponsorship_policies', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  version: integer('version').notNull(),
  status: policyStatus('status').default('draft').notNull(),
  schemaVersion: integer('schema_version').default(1).notNull(),
  document: jsonb('document').$type<Record<string, unknown>>().notNull(),
  documentHash: text('document_hash').notNull(),
  publishedBy: text('published_by').references(() => user.id),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, table => [uniqueIndex('policy_project_name_version_unique').on(table.projectId, table.name, table.version)])

/**
 * A physical sponsor account is shared by every project that binds it.  The
 * project-scoped sponsor_accounts row below is retained as the compatibility
 * binding used by existing intents and migration plans.
 */
export const sponsorTreasuries = pgTable('sponsor_treasuries', {
  id: uuid('id').defaultRandom().primaryKey(),
  network: network('network').notNull(),
  address: text('address').notNull(),
  signerProvider: text('signer_provider').default('local').notNull(),
  signerKeyReference: text('signer_key_reference').notNull(),
  capabilities: jsonb('capabilities').$type<Record<string, boolean>>().notNull(),
  status: projectStatus('status').default('active').notNull(),
  safetyBufferDrops: bigint('safety_buffer_drops', { mode: 'bigint' }).default(sql`0`).notNull(),
  observedBalanceDrops: bigint('observed_balance_drops', { mode: 'bigint' }).default(sql`0`).notNull(),
  reconciledAt: timestamp('reconciled_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, table => [uniqueIndex('sponsor_treasury_network_address_unique').on(table.network, table.address)])

export const sponsorAccounts = pgTable('sponsor_accounts', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'restrict' }),
  treasuryId: uuid('treasury_id').notNull().references(() => sponsorTreasuries.id, { onDelete: 'restrict' }),
  network: network('network').notNull(),
  address: text('address').notNull(),
  signerProvider: text('signer_provider').default('local').notNull(),
  signerKeyReference: text('signer_key_reference').notNull(),
  capabilities: jsonb('capabilities').$type<Record<string, boolean>>().notNull(),
  status: projectStatus('status').default('active').notNull(),
  safetyBufferDrops: bigint('safety_buffer_drops', { mode: 'bigint' }).default(sql`0`).notNull(),
  observedBalanceDrops: bigint('observed_balance_drops', { mode: 'bigint' }).default(sql`0`).notNull(),
  reconciledAt: timestamp('reconciled_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, table => [uniqueIndex('sponsor_project_network_unique').on(table.projectId, table.network)])

export const projectSponsorAccounts = pgTable('project_sponsor_accounts', {
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  sponsorAccountId: uuid('sponsor_account_id').notNull().references(() => sponsorAccounts.id, { onDelete: 'restrict' }),
  network: network('network').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, table => [primaryKey({ columns: [table.projectId, table.sponsorAccountId] }), uniqueIndex('project_sponsor_network_unique').on(table.projectId, table.network)])

export const fundingBalances = pgTable('funding_balances', {
  sponsorAccountId: uuid('sponsor_account_id').primaryKey().references(() => sponsorAccounts.id, { onDelete: 'cascade' }),
  treasuryId: uuid('treasury_id').notNull().references(() => sponsorTreasuries.id, { onDelete: 'cascade' }),
  pendingFeeDrops: bigint('pending_fee_drops', { mode: 'bigint' }).default(sql`0`).notNull(),
  capturedFeeDrops: bigint('captured_fee_drops', { mode: 'bigint' }).default(sql`0`).notNull(),
  pendingReserveDrops: bigint('pending_reserve_drops', { mode: 'bigint' }).default(sql`0`).notNull(),
  lockedReserveDrops: bigint('locked_reserve_drops', { mode: 'bigint' }).default(sql`0`).notNull(),
  version: integer('version').default(0).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
}, table => [uniqueIndex('funding_balance_treasury_unique').on(table.treasuryId)])

export const projectFundingBudgets = pgTable('project_funding_budgets', {
  projectId: uuid('project_id').primaryKey().references(() => projects.id, { onDelete: 'cascade' }),
  feeBudgetDrops: bigint('fee_budget_drops', { mode: 'bigint' }).default(sql`1000000`).notNull(),
  reserveBudgetDrops: bigint('reserve_budget_drops', { mode: 'bigint' }).default(sql`100000000`).notNull(),
  walletFeeQuotaDrops: bigint('wallet_fee_quota_drops', { mode: 'bigint' }).default(sql`100000`).notNull(),
  walletReserveQuotaDrops: bigint('wallet_reserve_quota_drops', { mode: 'bigint' }).default(sql`10000000`).notNull(),
  quotaPeriodSeconds: integer('quota_period_seconds').default(86400).notNull(),
  feeReservedDrops: bigint('fee_reserved_drops', { mode: 'bigint' }).default(sql`0`).notNull(),
  feeSpentDrops: bigint('fee_spent_drops', { mode: 'bigint' }).default(sql`0`).notNull(),
  reserveReservedDrops: bigint('reserve_reserved_drops', { mode: 'bigint' }).default(sql`0`).notNull(),
  reserveExposureDrops: bigint('reserve_exposure_drops', { mode: 'bigint' }).default(sql`0`).notNull(),
  version: integer('version').default(0).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
})

export const projectFundingQuotas = pgTable('project_funding_quotas', {
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  accountAddress: text('account_address').notNull(),
  periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
  feeReservedDrops: bigint('fee_reserved_drops', { mode: 'bigint' }).default(sql`0`).notNull(),
  feeSpentDrops: bigint('fee_spent_drops', { mode: 'bigint' }).default(sql`0`).notNull(),
  reserveReservedDrops: bigint('reserve_reserved_drops', { mode: 'bigint' }).default(sql`0`).notNull(),
  reserveExposureDrops: bigint('reserve_exposure_drops', { mode: 'bigint' }).default(sql`0`).notNull(),
  version: integer('version').default(0).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
}, table => [primaryKey({ columns: [table.projectId, table.accountAddress, table.periodStart] })])

export const sponsorshipIntents = pgTable('sponsorship_intents', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'restrict' }),
  sponsorAccountId: uuid('sponsor_account_id').references(() => sponsorAccounts.id, { onDelete: 'restrict' }),
  policyId: uuid('policy_id').references(() => sponsorshipPolicies.id, { onDelete: 'restrict' }),
  accountAddress: text('account_address').notNull(),
  network: network('network').notNull(),
  networkId: integer('network_id').notNull(),
  definitionsHash: text('definitions_hash').notNull(),
  mode: text('mode').notNull(),
  canonicalTransaction: jsonb('canonical_transaction').$type<Record<string, unknown>>().notNull(),
  canonicalHash: text('canonical_hash').notNull(),
  preparedLedgerIndex: bigint('prepared_ledger_index', { mode: 'number' }).notNull(),
  userSignedBlob: text('user_signed_blob'),
  sponsorSigningHash: text('sponsor_signing_hash'),
  requestHash: text('request_hash').notNull(),
  policySnapshot: jsonb('policy_snapshot').$type<Record<string, unknown>>().notNull(),
  estimatedFeeDrops: bigint('estimated_fee_drops', { mode: 'bigint' }).default(sql`0`).notNull(),
  estimatedReserveDrops: bigint('estimated_reserve_drops', { mode: 'bigint' }).default(sql`0`).notNull(),
  quotaPeriodStart: timestamp('quota_period_start', { withTimezone: true }),
  idempotencyKey: text('idempotency_key').notNull(),
  correlationId: text('correlation_id').notNull(),
  state: intentState('state').default('created').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
}, table => [uniqueIndex('intent_project_idempotency_unique').on(table.projectId, table.idempotencyKey), index('intent_project_state_idx').on(table.projectId, table.state), index('intent_account_idx').on(table.accountAddress)])

export const sponsorshipGrants = pgTable('sponsorship_grants', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  intentId: uuid('intent_id').notNull().references(() => sponsorshipIntents.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  audience: text('audience').notNull(),
  accountAddress: text('account_address').notNull(),
  canonicalHash: text('canonical_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, table => [index('grant_intent_idx').on(table.intentId)])

export const intentEvents = pgTable('intent_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  intentId: uuid('intent_id').notNull().references(() => sponsorshipIntents.id, { onDelete: 'cascade' }),
  version: integer('version').notNull(),
  fromState: intentState('from_state'),
  toState: intentState('to_state').notNull(),
  actor: text('actor').notNull(),
  reason: text('reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, table => [uniqueIndex('intent_event_version_unique').on(table.intentId, table.version)])

export const fundingLedgerEntries = pgTable('funding_ledger_entries', {
  id: uuid('id').defaultRandom().primaryKey(),
  sponsorAccountId: uuid('sponsor_account_id').notNull().references(() => sponsorAccounts.id, { onDelete: 'restrict' }),
  treasuryId: uuid('treasury_id').notNull().references(() => sponsorTreasuries.id, { onDelete: 'restrict' }),
  intentId: uuid('intent_id').references(() => sponsorshipIntents.id, { onDelete: 'restrict' }),
  type: fundingEntryType('type').notNull(),
  feeDrops: bigint('fee_drops', { mode: 'bigint' }).default(sql`0`).notNull(),
  reserveDrops: bigint('reserve_drops', { mode: 'bigint' }).default(sql`0`).notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  reason: text('reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, table => [uniqueIndex('funding_entry_idempotency_unique').on(table.sponsorAccountId, table.idempotencyKey), uniqueIndex('funding_treasury_entry_idempotency_unique').on(table.treasuryId, table.idempotencyKey)])

export const submissions = pgTable('submissions', {
  id: uuid('id').defaultRandom().primaryKey(),
  intentId: uuid('intent_id').notNull().references(() => sponsorshipIntents.id, { onDelete: 'restrict' }),
  attempt: integer('attempt').notNull(),
  signedBlob: text('signed_blob').notNull(),
  transactionHash: text('transaction_hash').notNull(),
  endpoint: text('endpoint').notNull(),
  engineResult: text('engine_result'),
  response: jsonb('response').$type<Record<string, unknown>>(),
  firstSubmittedLedgerIndex: bigint('first_submitted_ledger_index', { mode: 'number' }).notNull(),
  actualFeeDrops: bigint('actual_fee_drops', { mode: 'bigint' }),
  ledgerIndex: bigint('ledger_index', { mode: 'number' }),
  validatedAt: timestamp('validated_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, table => [uniqueIndex('submission_intent_attempt_unique').on(table.intentId, table.attempt), index('submission_tx_hash_idx').on(table.transactionHash)])

export const reserveObligations = pgTable('reserve_obligations', {
  id: uuid('id').defaultRandom().primaryKey(),
  sponsorAccountId: uuid('sponsor_account_id').notNull().references(() => sponsorAccounts.id, { onDelete: 'restrict' }),
  treasuryId: uuid('treasury_id').notNull().references(() => sponsorTreasuries.id, { onDelete: 'restrict' }),
  intentId: uuid('intent_id').notNull().references(() => sponsorshipIntents.id, { onDelete: 'restrict' }),
  ownerAddress: text('owner_address').notNull(),
  objectId: text('object_id'),
  objectType: text('object_type').notNull(),
  trustlineSide: text('trustline_side'),
  reserveDrops: bigint('reserve_drops', { mode: 'bigint' }).notNull(),
  state: text('state').notNull(),
  activatedLedgerIndex: bigint('activated_ledger_index', { mode: 'number' }),
  releasedLedgerIndex: bigint('released_ledger_index', { mode: 'number' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
}, table => [index('reserve_active_object_treasury_idx').on(table.treasuryId, table.ownerAddress, table.objectId), index('reserve_owner_idx').on(table.ownerAddress)])

export const usageEvents = pgTable('usage_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'restrict' }),
  intentId: uuid('intent_id').notNull().references(() => sponsorshipIntents.id, { onDelete: 'restrict' }),
  chargeType: text('charge_type').notNull(),
  feeDrops: bigint('fee_drops', { mode: 'bigint' }).default(sql`0`).notNull(),
  reserveDrops: bigint('reserve_drops', { mode: 'bigint' }).default(sql`0`).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, table => [uniqueIndex('usage_intent_charge_unique').on(table.intentId, table.chargeType), index('usage_project_created_idx').on(table.projectId, table.createdAt)])

export const outboxEvents = pgTable('outbox_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  aggregateType: text('aggregate_type').notNull(),
  aggregateId: text('aggregate_id').notNull(),
  eventType: text('event_type').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  attempts: integer('attempts').default(0).notNull(),
  availableAt: timestamp('available_at', { withTimezone: true }).defaultNow().notNull(),
  lockedAt: timestamp('locked_at', { withTimezone: true }),
  lockedBy: text('locked_by'),
  lockVersion: integer('lock_version').default(0).notNull(),
  lastError: text('last_error'),
  deadLetteredAt: timestamp('dead_lettered_at', { withTimezone: true }),
  processedAt: timestamp('processed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, table => [
  index('outbox_pending_idx').on(table.processedAt, table.availableAt),
  uniqueIndex('outbox_aggregate_event_unique').on(table.aggregateType, table.aggregateId, table.eventType)
])

export const networkSnapshots = pgTable('network_snapshots', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  network: network('network').notNull(),
  networkId: integer('network_id').notNull(),
  definitionsHash: text('definitions_hash').notNull(),
  amendmentId: text('amendment_id').notNull(),
  serverVersion: text('server_version').notNull(),
  rpcUrl: text('rpc_url').notNull(),
  ledgerIndex: bigint('ledger_index', { mode: 'number' }).notNull(),
  capabilities: jsonb('capabilities').$type<Record<string, boolean>>().notNull(),
  baseFeeDrops: bigint('base_fee_drops', { mode: 'bigint' }).notNull(),
  accountReserveDrops: bigint('account_reserve_drops', { mode: 'bigint' }).notNull(),
  objectReserveDrops: bigint('object_reserve_drops', { mode: 'bigint' }).notNull(),
  endpointHealthy: boolean('endpoint_healthy').notNull(),
  observedAt: timestamp('observed_at', { withTimezone: true }).defaultNow().notNull()
}, table => [uniqueIndex('network_snapshot_ledger_unique').on(table.projectId, table.ledgerIndex)])

export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'restrict' }),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'restrict' }),
  actor: text('actor').notNull(),
  action: text('action').notNull(),
  resourceType: text('resource_type').notNull(),
  resourceId: text('resource_id').notNull(),
  result: text('result').notNull(),
  requestId: text('request_id').notNull(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, table => [index('audit_org_created_idx').on(table.organizationId, table.createdAt), index('audit_created_idx').on(table.createdAt)])

export const platformControls = pgTable('platform_controls', {
  key: text('key').primaryKey(),
  paused: boolean('paused').default(false).notNull(),
  version: integer('version').default(1).notNull(),
  reason: text('reason'),
  updatedBy: text('updated_by').notNull().references(() => user.id, { onDelete: 'restrict' }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
})

export const workerHeartbeats = pgTable('worker_heartbeats', {
  workerName: text('worker_name').primaryKey(),
  instanceId: text('instance_id').notNull(),
  status: text('status').notNull(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull(),
  lastHeartbeatAt: timestamp('last_heartbeat_at', { withTimezone: true }).defaultNow().notNull()
})

export const reserveMigrationPlans = pgTable('reserve_migration_plans', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'restrict' }),
  sponsorAccountId: uuid('sponsor_account_id').notNull().references(() => sponsorAccounts.id, { onDelete: 'restrict' }),
  accountAddress: text('account_address').notNull(),
  network: network('network').notNull(),
  networkId: integer('network_id').notNull(),
  definitionsHash: text('definitions_hash').notNull(),
  inspectionLedgerIndex: bigint('inspection_ledger_index', { mode: 'number' }).notNull(),
  inspectionLedgerHash: text('inspection_ledger_hash').notNull(),
  state: text('state').default('inspected').notNull(),
  version: integer('version').default(1).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdBy: text('created_by').notNull().references(() => user.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
}, table => [index('reserve_plan_project_idx').on(table.projectId, table.createdAt)])

export const reserveMigrationTargets = pgTable('reserve_migration_targets', {
  id: uuid('id').defaultRandom().primaryKey(),
  planId: uuid('plan_id').notNull().references(() => reserveMigrationPlans.id, { onDelete: 'cascade' }),
  targetKey: text('target_key').notNull(),
  objectId: text('object_id'),
  objectType: text('object_type').notNull(),
  trustlineSide: text('trustline_side'),
  ownerAddress: text('owner_address').notNull(),
  observedSponsor: text('observed_sponsor'),
  snapshotHash: text('snapshot_hash').notNull(),
  reserveUnits: integer('reserve_units').default(1).notNull(),
  estimatedReserveDrops: bigint('estimated_reserve_drops', { mode: 'bigint' }).notNull(),
  classification: text('classification').notNull(),
  state: text('state').default('available').notNull(),
  intentId: uuid('intent_id').references(() => sponsorshipIntents.id, { onDelete: 'restrict' }),
  errorCode: text('error_code'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
}, table => [uniqueIndex('reserve_target_plan_key_unique').on(table.planId, table.targetKey), uniqueIndex('reserve_target_intent_unique').on(table.intentId)])

export const projectRelations = relations(projects, ({ one, many }) => ({ organization: one(organizations, { fields: [projects.organizationId], references: [organizations.id] }), apiKeys: many(apiKeys), intents: many(sponsorshipIntents) }))
export const intentRelations = relations(sponsorshipIntents, ({ one, many }) => ({ project: one(projects, { fields: [sponsorshipIntents.projectId], references: [projects.id] }), events: many(intentEvents) }))
