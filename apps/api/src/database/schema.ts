import { integer, jsonb, pgEnum, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

export const filingStatus = pgEnum('filing_status', [
  'DRAFT',
  'SUBMITTED',
  'UNDER_REVIEW',
  'APPROVED',
  'REJECTED',
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
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
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

export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;
export type ComplianceFiling = typeof complianceFilings.$inferSelect;
export type NewComplianceFiling = typeof complianceFilings.$inferInsert;
export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;
