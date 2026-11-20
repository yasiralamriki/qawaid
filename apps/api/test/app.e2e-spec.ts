import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { NestFactory } from '@nestjs/core';
import { PasswordHasher } from '@nestjs/authentication';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { databaseUrl } from '../src/database/environment.js';

// Real PostgreSQL and HTTP tests are opt-in. A disposable database is created and dropped.
const enabled = process.env.RUN_DATABASE_TESTS === '1';
// Variable imports let type checks run on a fresh checkout before dist exists.
const compiled = (name: string) => import(/* @vite-ignore */ new URL(`../dist/${name}.js`, import.meta.url).href);
describe.skipIf(!enabled)('PostgreSQL + HTTP acceptance', () => {
  let admin: pg.Pool;
  let pool: pg.Pool;
  let app: INestApplication;
  const database = `qawaid_test_${randomUUID().replaceAll('-', '')}`;
  let root: string;
  const password = 'integration-test-password';
  let submitterId: string;
  let tenantId: string;
  let cookies: Record<string, string>;
  const originalUrl = process.env.DATABASE_URL;
  const originalPort = process.env.PORT;
  const originalDatabase = process.env.PGDATABASE;
  const originalDisabled = process.env.REGISTRY_WORKER_DISABLED;

  beforeAll(async () => {
    const url = new URL(databaseUrl());
    admin = new pg.Pool({ connectionString: url.toString() });
    await admin.query(`CREATE DATABASE "${database}"`);
    url.pathname = `/${database}`;
    process.env.DATABASE_URL = url.toString();
    if (process.env.PGHOST) process.env.PGDATABASE = database;
    process.env.REGISTRY_WORKER_DISABLED = '1';
    pool = new pg.Pool({ connectionString: url.toString() });
    await migrate(drizzle(pool), { migrationsFolder: './drizzle' });
    const a = await pool.query(
      "INSERT INTO tenants(name, identifier_cr) VALUES ('Company A','TEST-A'),('Company B','TEST-B') RETURNING id",
    );
    tenantId = a.rows[0].id;
    const hash = await new PasswordHasher().hash(password);
    const identities = [
      ['submitter', tenantId, 'SUBMITTER'],
      ['auditor', tenantId, 'AUDITOR'],
      ['auditor2', tenantId, 'AUDITOR'],
      ['other', a.rows[1].id, 'AUDITOR'],
      ['admin', null, 'SYSTEM_ADMIN'],
    ];
    for (const [name, tenant, role] of identities) {
      const row = await pool.query(
        'INSERT INTO users(username,password_hash,tenant_id,role) VALUES($1,$2,$3,$4) RETURNING id',
        [name, hash, tenant, role],
      );
      if (name === 'submitter') submitterId = row.rows[0].id;
    }
    // Load compiled Nest modules so decorator metadata matches a real startup.
    const { AppModule } = await compiled('app.module');
    app = await NestFactory.create(AppModule, { logger: false });
    app.setGlobalPrefix('api', { exclude: ['mock-registry/verify'] });
    app.enableCsrfProtection({ trustedOrigins: ['http://localhost:3000'] });
    await app.listen(0, '127.0.0.1');
    root = await app.getUrl();
    process.env.PORT = new URL(root).port;
    cookies = {};
    for (const [name] of identities) {
      const response = await request(root)
        .post('/api/auth/sign-in')
        .send({ username: name, password })
        .expect(200);
      cookies[name!] = (response.headers['set-cookie'] as unknown as string[])
        .map((value) => value.split(';')[0])
        .join('; ');
    }
  }, 30000);

  afterAll(async () => {
    vi.restoreAllMocks();
    if (app) await app.close();
    if (pool) await pool.end();
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS "${database}"`);
      await admin.end();
    }
    if (originalUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalUrl;
    if (originalDatabase === undefined) delete process.env.PGDATABASE;
    else process.env.PGDATABASE = originalDatabase;
    if (originalPort === undefined) delete process.env.PORT;
    else process.env.PORT = originalPort;
    if (originalDisabled === undefined)
      delete process.env.REGISTRY_WORKER_DISABLED;
    else process.env.REGISTRY_WORKER_DISABLED = originalDisabled;
  });

  async function filing(status = 'UNDER_REVIEW') {
    return (
      await pool.query(
        "INSERT INTO compliance_filings(tenant_id,created_by,title,category,status,version,expiration_date) VALUES($1,$2,'License','License',$3,3,'2027-12-31') RETURNING *",
        [tenantId, submitterId, status],
      )
    ).rows[0];
  }
  function action(
    id: string,
    name: string,
    who = 'auditor',
    expectedVersion = 3,
  ) {
    return request(root)
      .post(`/api/filings/${id}/${name}`)
      .set('Cookie', cookies[who])
      .send({ expectedVersion, rejectionReason: 'Missing evidence' });
  }

  it('enforces sessions, tenant isolation, and reporting-only admin permissions', async () => {
    const f = await filing();
    await request(root).get('/api/filings').expect(401);
    for (const who of ['submitter', 'admin', 'other'])
      await action(f.id, 'approve', who).expect(403);
    await request(root)
      .get(`/api/filings/${f.id}/audit-history`)
      .set('Cookie', cookies.other)
      .expect(403);
    const list = await request(root)
      .get('/api/filings')
      .set('Cookie', cookies.other)
      .expect(200);
    expect(list.body).toEqual([]);
    const stats = await request(root)
      .get('/api/filings/dashboard-stats')
      .set('Cookie', cookies.admin)
      .expect(200);
    expect(stats.body.totalFilings).toBeGreaterThan(0);
  });

  it('completes the submit/start/reject lifecycle and excludes final records from pending SQL view', async () => {
    const created = await request(root)
      .post('/api/filings')
      .set('Cookie', cookies.submitter)
      .send({
        title: 'New license',
        category: 'License',
        expirationDate: '2027-12-31',
        identifierCr: 'TEST-A',
      })
      .expect(201);
    await action(created.body.id, 'submit', 'submitter', 1).expect(201);
    await action(created.body.id, 'start-review', 'auditor', 2).expect(201);
    await request(root)
      .post(`/api/filings/${created.body.id}/reject`)
      .set('Cookie', cookies.auditor)
      .send({ expectedVersion: 3, rejectionReason: '   ' })
      .expect(400);
    await action(created.body.id, 'reject').expect(201);
    const saved = (
      await pool.query('SELECT * FROM compliance_filings WHERE id=$1', [
        created.body.id,
      ])
    ).rows[0];
    expect(saved).toMatchObject({
      status: 'REJECTED',
      rejection_reason: 'Missing evidence',
      version: 4,
    });
    const pending = await request(root)
      .get('/api/filings?view=pending')
      .set('Cookie', cookies.auditor)
      .expect(200);
    expect(
      pending.body.some((row: { id: string }) => row.id === saved.id),
    ).toBe(false);
    await request(root)
      .get(`/api/filings/${saved.id}/audit-history`)
      .set('Cookie', cookies.auditor)
      .expect(200);
    await action(saved.id, 'approve').expect(409);
    const draft = await filing('DRAFT');
    await action(draft.id, 'approve').expect(400);
  });

  it('allows exactly one real concurrent verdict and one audit entry', async () => {
    const f = await filing();
    const responses = await Promise.all([
      action(f.id, 'approve'),
      action(f.id, 'reject', 'auditor2'),
    ]);
    expect(
      responses.map((response) => response.status).sort((a, b) => a - b),
    ).toEqual([201, 409]);
    const events = await pool.query(
      'SELECT * FROM audit_logs WHERE filing_id=$1',
      [f.id],
    );
    expect(events.rowCount).toBe(1);
    const saved = (
      await pool.query('SELECT * FROM compliance_filings WHERE id=$1', [f.id])
    ).rows[0];
    expect(saved.version).toBe(4);
    expect(events.rows[0].new_state).toBe(saved.status);
  });

  it('rolls back the verdict and queued job if PostgreSQL rejects the audit insert', async () => {
    const f = await filing();
    await pool.query(
      `CREATE FUNCTION fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.filing_id = '${f.id}'::uuid THEN RAISE EXCEPTION 'Test audit failure'; END IF; RETURN NEW; END $$`,
    );
    await pool.query(
      'CREATE TRIGGER fail_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION fail_audit()',
    );
    try {
      await action(f.id, 'approve').expect(500);
      expect(
        (
          await pool.query(
            'SELECT status,version FROM compliance_filings WHERE id=$1',
            [f.id],
          )
        ).rows[0],
      ).toEqual({ status: 'UNDER_REVIEW', version: 3 });
      expect(
        (
          await pool.query('SELECT * FROM registry_jobs WHERE filing_id=$1', [
            f.id,
          ])
        ).rowCount,
      ).toBe(0);
    } finally {
      await pool.query('DROP TRIGGER fail_audit ON audit_logs');
      await pool.query('DROP FUNCTION fail_audit()');
    }
  });

  it('retries 503 with backoff, replays idempotent results, and stores a stable reference', async () => {
    const f = await filing();
    await action(f.id, 'approve').expect(201);
    // Process only this test's job.
    await pool.query(
      "UPDATE registry_jobs SET next_attempt_at=now()+interval '1 day' WHERE filing_id<>$1",
      [f.id],
    );
    const { RegistryWorker } =
      await compiled('mock-registry/registry.worker');
    const worker = app.get(RegistryWorker);
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.1);
    await worker.processNext();
    let job = (
      await pool.query('SELECT * FROM registry_jobs WHERE filing_id=$1', [f.id])
    ).rows[0];
    expect(job.status).toBe('RETRYING');
    expect(job.attempts).toBe(1);
    expect(
      new Date(job.next_attempt_at).getTime() -
        new Date(job.updated_at).getTime(),
    ).toBeGreaterThanOrEqual(900);
    random.mockReturnValue(0.9);
    await pool.query(
      'UPDATE registry_jobs SET next_attempt_at=now() WHERE filing_id=$1',
      [f.id],
    );
    await worker.processNext();
    job = (
      await pool.query('SELECT * FROM registry_jobs WHERE filing_id=$1', [f.id])
    ).rows[0];
    expect(job.status).toBe('VERIFIED');
    expect(job.attempts).toBe(2);
    // Duplicate replay is checked before simulated failures.
    random.mockReturnValue(0.1);
    const response = await request(root)
      .post('/mock-registry/verify')
      .set('Idempotency-Key', `filing-${f.id}-2`)
      .send({ filingId: f.id, identifierCr: 'TEST-A' })
      .expect(201);
    expect(response.body.referenceId).toBe(job.reference_id);
    expect(
      (
        await pool.query(
          'SELECT external_reference_id,status FROM compliance_filings WHERE id=$1',
          [f.id],
        )
      ).rows[0],
    ).toEqual({ external_reference_id: job.reference_id, status: 'APPROVED' });
    random.mockRestore();
  });

  it('exhausts bounded retries without reversing approval and recovers an expired lease', async () => {
    const f = await filing();
    await action(f.id, 'approve').expect(201);
    await pool.query(
      "UPDATE registry_jobs SET next_attempt_at=now()+interval '1 day' WHERE filing_id<>$1",
      [f.id],
    );
    await pool.query(
      "UPDATE registry_jobs SET status='PROCESSING',lease_token=$2,next_attempt_at=now()-interval '1 second' WHERE filing_id=$1",
      [f.id, randomUUID()],
    );
    const { RegistryWorker } =
      await compiled('mock-registry/registry.worker');
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.1);
    try {
      for (let i = 0; i < 4; i++) {
        await app.get(RegistryWorker).processNext();
        await pool.query(
          'UPDATE registry_jobs SET next_attempt_at=now() WHERE filing_id=$1',
          [f.id],
        );
      }
      expect(
        (
          await pool.query(
            'SELECT status,attempts FROM registry_jobs WHERE filing_id=$1',
            [f.id],
          )
        ).rows[0],
      ).toEqual({ status: 'FAILED', attempts: 4 });
      expect(
        (
          await pool.query(
            'SELECT status FROM compliance_filings WHERE id=$1',
            [f.id],
          )
        ).rows[0].status,
      ).toBe('APPROVED');
    } finally {
      random.mockRestore();
    }
  });
  it('seeds two companies and lifecycle samples safely on repeated startup', async () => {
    const run = promisify(execFile);
    const env = { ...process.env, SEED_PASSWORD: password };
    await run(process.execPath, ['dist/auth/seed.js'], { env });
    const first = await pool.query(
      "SELECT count(*)::int AS count FROM compliance_filings WHERE title LIKE '%license' AND tenant_id IN (SELECT id FROM tenants WHERE identifier_cr LIKE 'DEMO-%')",
    );
    expect(first.rows[0].count).toBe(10);
    await run(process.execPath, ['dist/auth/seed.js'], { env });
    const second = await pool.query(
      "SELECT count(*)::int AS count FROM compliance_filings WHERE tenant_id IN (SELECT id FROM tenants WHERE identifier_cr LIKE 'DEMO-%')",
    );
    expect(second.rows[0].count).toBe(10);
  }, 15000);
});
