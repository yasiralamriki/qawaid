import { PasswordHasher } from '@nestjs/authentication';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { databaseUrl } from '../database/environment.js';
import { tenants, users } from '../database/schema.js';
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
    });
    console.log('Demo accounts created; existing accounts unchanged.');
  } finally {
    await pool.end();
  }
}

seed().catch(() => { console.error('Seed failed. Check database access and SEED_PASSWORD.'); process.exitCode = 1; });