import { createHash } from 'node:crypto';
import { PasswordHasher } from '@nestjs/authentication';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { databaseUrl } from '../database/environment.js';
import { tenants, users, complianceFilings, auditLogs, registryJobs } from '../database/schema.js';
import { normalizeUsername, type Role } from '../users/user.js';

// Run only for local development. Existing users and passwords are not overwritten.
async function seed() {
  const connectionString = databaseUrl(); // Also loads apps/api/.env.
  const password = process.env.SEED_PASSWORD;
  if (!password || password.length < 12) throw new Error('Set SEED_PASSWORD to at least 12 characters');
  const pool = new pg.Pool({ connectionString });
  const db = drizzle(pool);
  try {
    const passwordHash = await new PasswordHasher().hash(password);
    await db.transaction(async (tx) => {
      await tx.insert(tenants).values([
        { name: 'Aram Organics', identifierCr: 'DEMO-ARAM' },
        { name: 'Riyadh Logistics', identifierCr: 'DEMO-RIYADH' },
      ]).onConflictDoNothing();
      const companies = await tx.select().from(tenants);
      const aram = companies.find(t => t.identifierCr === 'DEMO-ARAM')!;
      const riyadh = companies.find(t => t.identifierCr === 'DEMO-RIYADH')!;
      const accounts: { username: string; tenantId: string | null; role: Role }[] = [
        { username: 'aram.submitter', tenantId: aram.id, role: 'SUBMITTER' },
        { username: 'aram.auditor', tenantId: aram.id, role: 'AUDITOR' },
        { username: 'riyadh.submitter', tenantId: riyadh.id, role: 'SUBMITTER' },
        { username: 'riyadh.auditor', tenantId: riyadh.id, role: 'AUDITOR' },
        { username: 'admin', tenantId: null, role: 'SYSTEM_ADMIN' },
      ];
      await tx.insert(users).values(accounts.map(account => ({
        ...account, username: normalizeUsername(account.username), passwordHash,
      }))).onConflictDoNothing({ target: users.username });
      const seededUsers = await tx.select().from(users);
      for (const company of [aram, riyadh]) {
        const submitter = seededUsers.find(u => u.tenantId === company.id && u.role === 'SUBMITTER')!;
        const auditor = seededUsers.find(u => u.tenantId === company.id && u.role === 'AUDITOR')!;
        const states = ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED'] as const;
        for (const [index, status] of states.entries()) {
          const hex = createHash('sha256').update(`qawaid-demo:${company.identifierCr}:${status}`).digest('hex');
          const id = `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;
          const [inserted] = await tx.insert(complianceFilings).values({
            id, tenantId: company.id, createdBy: submitter.id, title: `${company.name} — ${status.toLowerCase()} license`,
            category: 'License', expirationDate: new Date('2027-12-31T00:00:00Z'), status,
            version: index < 3 ? index + 1 : 4,
            assignedReviewerId: index >= 2 ? auditor.id : null,
            rejectionReason: status === 'REJECTED' ? 'Provide the missing license evidence.' : null,
          }).onConflictDoNothing().returning();
          if (!inserted) continue;
          const history: { action: string; previousState: string | null; newState: string; actorId: string }[] = [
            { action: 'CREATE_DRAFT', previousState: null, newState: 'DRAFT', actorId: submitter.id },
          ];
          if (index >= 1) history.push({ action: 'SUBMIT_FOR_REVIEW', previousState: 'DRAFT', newState: 'SUBMITTED', actorId: submitter.id });
          if (index >= 2) history.push({ action: 'START_REVIEW', previousState: 'SUBMITTED', newState: 'UNDER_REVIEW', actorId: auditor.id });
          if (index >= 3) history.push({ action: status === 'APPROVED' ? 'APPROVE_FILING' : 'REJECT_FILING', previousState: 'UNDER_REVIEW', newState: status, actorId: auditor.id });
          await tx.insert(auditLogs).values(history.map((event, step) => ({ ...event, filingId: id,
            timestamp: new Date(Date.now() - (history.length - step) * 1000),
            metadata: event.newState === 'REJECTED' ? { rejectionReason: inserted.rejectionReason } : null,
          })));
          if (status === 'APPROVED') await tx.insert(registryJobs).values({ filingId: id });
        }
      }

    });
    console.log('Demo accounts created; existing accounts unchanged.');
  } finally {
    await pool.end();
  }
}

seed().catch(() => { console.error('Seed failed. Check database access and SEED_PASSWORD.'); process.exitCode = 1; });