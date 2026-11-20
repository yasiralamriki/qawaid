import { integer, jsonb, pgEnum, pgTable, text, timestamp, uuid, varchar, check, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const filingStatus = pgEnum('filing_status', [
  'DRAFT',
  'SUBMITTED',
  'UNDER_REVIEW',
  'APPROVED',
  'REJECTED',
]);

export const userRole = pgEnum('user_role', [
  'SUBMITTER', 'AUDITOR', 'SYSTEM_ADMIN',
]);

export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 120 }).notNull(),
  identifierCr: varchar('identifier_cr', { length: 20 }).unique().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const complianceFilings = pgTable('compliance_filings', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  title: varchar('title', { length: 255 }).notNull(),
  category: varchar('category', { length: 50 }).notNull(),
  status: filingStatus('status').default('DRAFT'),
  version: integer('version').notNull().default(1),
  assignedReviewerId: uuid('assigned_reviewer_id'),
  rejectionReason: text('rejection_reason'),
  externalReferenceId: varchar('external_reference_id', { length: 100 }),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  expirationDate: timestamp('expiration_date', { withTimezone: true }),
});

export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  filingId: uuid('filing_id').notNull().references(() => complianceFilings.id, { onDelete: 'cascade' }),
  actorId: uuid('actor_id').notNull(),
  action: varchar('action', { length: 50 }).notNull(),
  previousState: varchar('previous_state', { length: 50 }),
  newState: varchar('new_state', { length: 50 }),
  metadata: jsonb('metadata'),
  timestamp: timestamp('timestamp', { withTimezone: true }).defaultNow(),
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  username: varchar('username', { length: 120 }).notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'restrict' }),
  role: userRole('role').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check('users_tenant_role_check', sql`
    (${table.role} = 'SYSTEM_ADMIN' AND ${table.tenantId} IS NULL)
    OR (${table.role} <> 'SYSTEM_ADMIN' AND ${table.tenantId} IS NOT NULL)
  `),
]);

export const authSessions = pgTable('auth_sessions', {
  // Session IDs are token hashes supplied by the authentication package, not UUIDs.
  id: text('id').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  lastActiveAt: timestamp('last_active_at', { withTimezone: true }).notNull(),
  mfa: text('mfa', { enum: ['pending', 'verified'] }),
  metadata: jsonb('metadata').$type<Record<string, unknown>>(),
}, (table) => [
  index('auth_sessions_user_idx').on(table.userId),
  index('auth_sessions_expiry_idx').on(table.expiresAt),
]);

export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;
export type ComplianceFiling = typeof complianceFilings.$inferSelect;
export type NewComplianceFiling = typeof complianceFilings.$inferInsert;
export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type AuthSession = typeof authSessions.$inferSelect;
export type NewAuthSession = typeof authSessions.$inferInsert;

// Approval and its verification job commit together; leases allow crash recovery.
export const registryJobs = pgTable('registry_jobs', {
  filingId: uuid('filing_id').primaryKey().references(() => complianceFilings.id, { onDelete: 'cascade' }),
  status: varchar('status', { length: 20 }).notNull().default('PENDING'),
  attempts: integer('attempts').notNull().default(0),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
  leaseToken: uuid('lease_token'),
  lastError: text('last_error'),
  referenceId: varchar('reference_id', { length: 100 }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const registryResults = pgTable('registry_results', {
  idempotencyKey: varchar('idempotency_key', { length: 160 }).primaryKey(),
  filingId: uuid('filing_id').notNull().unique().references(() => complianceFilings.id, { onDelete: 'cascade' }),
  identifierCr: varchar('identifier_cr', { length: 20 }).notNull(),
  referenceId: varchar('reference_id', { length: 100 }).notNull(),
  verifiedAt: timestamp('verified_at', { withTimezone: true }).notNull().defaultNow(),
});
