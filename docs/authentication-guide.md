# Qawaid: username/password authentication with NestJS, Drizzle and PostgreSQL

This is a follow-along tutorial for your current repository, not a change to your application. All paths in code headings below are relative to `apps/api`, unless they start with `apps/web`. The examples target your installed NestJS 12, `@nestjs/authentication` 0.1.5 and Drizzle ORM 0.45.x. Run terminal commands from the repository root unless stated otherwise.

## Current authorization snapshot — November 20, 2026

This document remains a follow-along authentication tutorial. Current review authorization and task status are maintained in [remaining tasks](./remaining-tasks.md); tutorial examples are not a fresh application status report.

- Auditor review actions are part of `/filings`; `/reviews` redirects there. Submitters/admins receive their role-appropriate filing views.
- Start Review, Approve, and Reject require AUDITOR plus the authenticated tenant; their updates check status and expected version.
- Review actions do not require creator ownership. Submitter draft editing/submission still do.
- Audit history permits own filings for submitters, permitted company filings for auditors, and global read-only access for system admins.
- Admin visibility does not grant permission to review or mutate filings.

Review rejection requires and saves a reason; pending SQL filtering and lifecycle/conflict responses are implemented. Seven isolated PostgreSQL/HTTP acceptance tests verify access, workflow integrity, registry retries/idempotency, and repeat seeding. The public mock creates synthetic in-memory verification results only; it does not read or modify application filings. The worker calls it without browser session credentials. WEB_ORIGIN controls the trusted frontend origin (default http://localhost:3000). See [required delivery status](./remaining-tasks.md) and the README; historical tutorial steps below are not an inventory of unfinished work.

## What you will build

- Seeded usernames and hashed passwords in PostgreSQL, with no public registration.
- A browser session stored in PostgreSQL, represented by an HttpOnly cookie.
- `POST /api/auth/sign-in`, `GET /api/auth/me`, and `POST /api/auth/sign-out`.
- An authenticated identity containing `id`, `username`, `tenantId` and `role`.

The request path is browser → Next.js `/api` rewrite → NestJS → PostgreSQL. Next.js presents the form. NestJS verifies credentials and owns sessions. Drizzle reads/writes tables; it is not itself the authentication system. The browser stores the cookie and sends it automatically; do not put a token in localStorage.

Your existing tables (`tenants`, `compliance_filings`, `audit_logs`) remain in place. Your package.json already contains the authentication, Drizzle, PostgreSQL and dotenv dependencies. The login form currently has fields but no JavaScript submit handler.

### Intentional choices

A username is globally unique and normalized to lowercase. This lets the existing username/password form identify a user without an organization selector. Ordinary users belong to exactly one company; system admins have no tenant. One role per user is sufficient for this assessment. Multi-company membership can be added later with a membership table.

## 1. Organize the backend

Create these folders under `apps/api/src`:

```text
users/
  user.ts
  users.repository.ts
  users.module.ts
auth/
  drizzle-session.store.ts
  session-auth.provider.ts
  sign-in.pipe.ts
  auth.controller.ts
  auth.module.ts
  seed.ts
```

Continue using `src/database/schema.ts` for tables and your existing `DatabaseModule`. Do not create a second Drizzle connection inside the auth module. Relative TypeScript imports end in `.js` because this repository uses ESM.

## 2. Add users and sessions to the schema

Append the following to `apps/api/src/database/schema.ts`. Keep all existing definitions. The additional imports may instead be merged into the imports at the top.

```ts

// Add these imports alongside your existing schema imports.
import { check, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const userRole = pgEnum('user_role', [
  'SUBMITTER', 'AUDITOR', 'SYSTEM_ADMIN',
]);

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
```

`passwordHash` holds a one-way password hash, never the actual password. `authSessions.id` is a hash of a random cookie token; it is text, not a generated UUID. The package supplies session timestamps, so these columns deliberately have no database defaults. The optional MFA field supports the session contract; MFA itself is not enabled here.

The database check prevents tenant-less ordinary users and tenant-bound global admins. The user foreign key restricts deleting a company that still has users; it does not add deletion behavior to your existing filings.

Generate and apply a new migration. Do not edit the migration you already applied for the filing schema.

```sh
pnpm --dir apps/api db:generate --name authentication
pnpm --dir apps/api db:migrate
```

For a fully containerized environment, use the same commands with `sudo docker compose exec api` before `pnpm db:generate --name authentication` and `pnpm db:migrate`. The API container must already be running. If you enable authentication before migrating, you can start just PostgreSQL and run migrations from the host to avoid a startup dependency loop.

## 3. Define the user identity and repository

The public identity excludes the password hash. The repository deliberately has a separate internal credential lookup.

### `src/users/user.ts`

```ts
export type Role = 'SUBMITTER' | 'AUDITOR' | 'SYSTEM_ADMIN';

export interface AppUser {
  id: string;
  username: string;
  tenantId: string | null;
  role: Role;
}

export const normalizeUsername = (value: string) =>
  value.trim().normalize('NFC').toLowerCase();
```

### `src/users/users.repository.ts`

```ts
import { Injectable } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { users } from '../database/schema.js';
import { normalizeUsername, type AppUser } from './user.js';

const publicFields = {
  id: users.id, username: users.username,
  tenantId: users.tenantId, role: users.role,
};

@Injectable()
export class UsersRepository {
  constructor(@InjectDrizzle() private readonly db: NodePgDatabase) {}

  async findById(id: string): Promise<AppUser | null> {
    const [user] = await this.db.select(publicFields).from(users)
      .where(eq(users.id, id)).limit(1);
    return user ?? null;
  }

  // Internal credential lookup: never return this result from a controller.
  async findCredentials(username: string) {
    const [row] = await this.db.select({ ...publicFields, passwordHash: users.passwordHash })
      .from(users).where(eq(users.username, normalizeUsername(username))).limit(1);
    if (!row) return null;
    const { passwordHash, ...user } = row;
    return { user, passwordHash };
  }
}
```

### `src/users/users.module.ts`

```ts
import { Module } from '@nestjs/common';
import { UsersRepository } from './users.repository.js';

@Module({ providers: [UsersRepository], exports: [UsersRepository] })
export class UsersModule {}
```

## 4. Persist sessions through Drizzle

The package needs a `SessionStore`: an adapter with six methods connecting its session logic to your database. This provider registers itself with `AuthenticationStorage`; merely exporting the class is insufficient.

Touching a session must update an existing row atomically, without recreating deleted sessions or moving activity timestamps backward. This matters when a request races with logout.

### `src/auth/drizzle-session.store.ts`

```ts
import { Injectable } from '@nestjs/common';
import { AuthenticationStorage, type SessionRecord, type SessionStore } from '@nestjs/authentication';
import { InjectDrizzle } from '@nestjs/drizzle';
import { and, eq, lt, lte } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { authSessions } from '../database/schema.js';

function toSession(row: typeof authSessions.$inferSelect): SessionRecord {
  return { ...row, mfa: row.mfa ?? undefined, metadata: row.metadata ?? undefined };
}

@Injectable()
export class DrizzleSessionStore implements SessionStore {
  constructor(
    @InjectDrizzle() private readonly db: NodePgDatabase,
    storage: AuthenticationStorage,
  ) {
    storage.registerSource({ sessions: this });
  }

  async getSession(id: string): Promise<SessionRecord | undefined> {
    const [row] = await this.db.select().from(authSessions).where(eq(authSessions.id, id));
    return row ? toSession(row) : undefined;
  }

  async createSession(record: SessionRecord): Promise<void> {
    await this.db.insert(authSessions).values({
      id: record.id, userId: record.userId, createdAt: record.createdAt,
      expiresAt: record.expiresAt, lastActiveAt: record.lastActiveAt,
      mfa: record.mfa, metadata: record.metadata,
    });
    await this.db.delete(authSessions).where(lte(authSessions.expiresAt, record.createdAt));
  }

  async touchSession(id: string, lastActiveAt: Date): Promise<void> {
    await this.db.update(authSessions).set({ lastActiveAt }).where(and(
      eq(authSessions.id, id), lt(authSessions.lastActiveAt, lastActiveAt),
    ));
  }

  async deleteSession(id: string): Promise<boolean> {
    const deleted = await this.db.delete(authSessions).where(eq(authSessions.id, id))
      .returning({ id: authSessions.id });
    return deleted.length > 0;
  }

  async listUserSessions(userId: string): Promise<SessionRecord[]> {
    const rows = await this.db.select().from(authSessions).where(eq(authSessions.userId, userId));
    return rows.map(toSession);
  }

  async deleteUserSessions(userId: string): Promise<void> {
    await this.db.delete(authSessions).where(eq(authSessions.userId, userId));
  }
}
```

## 5. Teach the authentication guard how to load your user

A session identifies a user ID. This provider resolves that ID into the current database user, including the current tenant and role. Permission changes therefore take effect on the next request; they are not frozen into a long-lived token.

### `src/auth/session-auth.provider.ts`

```ts
import { Injectable } from '@nestjs/common';
import { AuthenticationRegistry, SessionCookieProvider, type SessionRecord } from '@nestjs/authentication';
import { UsersRepository } from '../users/users.repository.js';
import type { AppUser } from '../users/user.js';

@Injectable()
export class SessionAuth extends SessionCookieProvider<AppUser> {
  constructor(private readonly users: UsersRepository, registry: AuthenticationRegistry) {
    super();
    registry.registerProvider(this);
  }

  validate(session: SessionRecord) {
    return this.users.findById(session.userId);
  }
}
```

## 6. Validate input and implement the endpoints

The custom pipe keeps this initial walkthrough independent of any additional validation library. It validates untrusted JSON at runtime, normalizes usernames, and leaves passwords untouched. A TypeScript interface alone would not validate incoming requests. You can replace this pipe with the project's Zod validation later.

### `src/auth/sign-in.pipe.ts`

```ts
import { BadRequestException, Injectable, type PipeTransform } from '@nestjs/common';
import { normalizeUsername } from '../users/user.js';

export interface SignInBody { username: string; password: string }

@Injectable()
export class SignInPipe implements PipeTransform<unknown, SignInBody> {
  transform(value: unknown): SignInBody {
    if (!value || typeof value !== 'object') throw new BadRequestException('Invalid login input');
    const { username, password } = value as Record<string, unknown>;
    if (typeof username !== 'string' || typeof password !== 'string') {
      throw new BadRequestException('Username and password are required');
    }
    const normalized = normalizeUsername(username);
    if (!normalized || normalized.length > 120 || !password || password.length > 1024) {
      throw new BadRequestException('Invalid username or password length');
    }
    return { username: normalized, password };
  }
}
```

### `src/auth/auth.controller.ts`

```ts
import { Body, Controller, Get, HttpCode, Post, UnauthorizedException } from '@nestjs/common';
import { CurrentUser, PasswordHasher, Public, SignInService } from '@nestjs/authentication';
import { UsersRepository } from '../users/users.repository.js';
import type { AppUser } from '../users/user.js';
import { SignInPipe, type SignInBody } from './sign-in.pipe.js';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly users: UsersRepository,
    private readonly passwords: PasswordHasher,
    private readonly signIn: SignInService,
  ) {}

  @Public()
  @Post('sign-in')
  @HttpCode(200)
  async login(@Body(SignInPipe) body: SignInBody) {
    const found = await this.users.findCredentials(body.username);
    // An unknown account still runs the package's dummy-hash check.
    const valid = await this.passwords.verify(body.password, found?.passwordHash);
    if (!found || !valid) throw new UnauthorizedException('Invalid username or password');
    await this.signIn.signIn(found.user.id, { method: 'password' });
    return found.user;
  }

  @Get('me')
  me(@CurrentUser() user: AppUser) {
    return user;
  }

  @Post('sign-out')
  @HttpCode(204)
  async logout() {
    await this.signIn.signOut();
  }
}
```

Only the login endpoint is public. Invalid credentials produce the same generic 401 for unknown users and wrong passwords. The package hashes/verifies passwords and creates/clears the cookie; the controller never returns session tokens or password hashes. Logout is protected and returns 204; an already expired session can instead receive 401, which the frontend can treat as already logged out.

### `src/auth/auth.module.ts`

```ts
import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module.js';
import { AuthController } from './auth.controller.js';
import { DrizzleSessionStore } from './drizzle-session.store.js';
import { SessionAuth } from './session-auth.provider.js';
import { SignInPipe } from './sign-in.pipe.js';

@Module({
  imports: [UsersModule],
  controllers: [AuthController],
  providers: [DrizzleSessionStore, SessionAuth, SignInPipe],
})
export class AuthModule {}
```

## 7. Register authentication and keep health checks public

Use the following root module, preserving any other application modules you have added in the meantime.

### `src/app.module.ts`

```ts
import { Module } from '@nestjs/common';
import { AuthenticationModule } from '@nestjs/authentication';
import { DatabaseModule } from './database/database.module.js';
import { AuthModule } from './auth/auth.module.js';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';

@Module({
  imports: [
    DatabaseModule,
    AuthenticationModule.forRoot({
      session: {
        absoluteTtl: '7d',
        idleTtl: '1d',
        trustedOrigins: ['http://localhost:3000'],
      },
    }),
    AuthModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
```

The authentication module registers a global guard: ordinary API routes now require a user. You do not need to add a JWT guard or cookie-parser. Do not import an in-memory session store; the provider from step 4 replaces it with PostgreSQL storage.

Important for Docker: the current Compose configuration waits for `/api/health/database` before starting Next.js. Add the following import and decorator to `apps/api/src/database/database.controller.ts`, or the health check will become 401 and the frontend will never start:

```ts
import { Public } from '@nestjs/authentication';

// Inside DatabaseController, above the existing database() method:
@Public()
@Get('database')
```

Keep the existing method body. Mark the root hello endpoint public only if you deliberately want it accessible anonymously; otherwise a 401 there is expected.

Your installed NestJS exposes CSRF protection. In `main.ts`, after creating `app`, add:

```ts
app.enableCsrfProtection({ trustedOrigins: ['http://localhost:3000'] });
```

Preserve `app.setGlobalPrefix('api')`, shutdown hooks and port 4000. The trusted origin is the browser-facing URL, not Docker's `http://web:3000` or `http://api:4000`. Use the same exact public origin in both settings when you deploy. Keep the default secure HttpOnly cookie; localhost supports it in mainstream browsers. Use localhost consistently rather than mixing it with `127.0.0.1` or a LAN hostname. Production needs HTTPS.

## 8. Seed the two companies and demo users

There is no registration endpoint in this tutorial. This local-only seed creates five accounts and hashes their password using the same hasher as login.

### `src/auth/seed.ts`

```ts
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
```

Add a script to `apps/api/package.json`:

```json
"auth:seed": "pnpm build && node dist/auth/seed.js"
```

Set `SEED_PASSWORD` to a development-only password of at least 12 characters, then run:

```sh
pnpm --dir apps/api auth:seed
```

You can put `SEED_PASSWORD` temporarily in the ignored `apps/api/.env`; do not commit it. All five demo users share this password only to simplify the assessment. Existing accounts are not reset on a second seed run. In Docker, pass the password to the running container and run `pnpm auth:seed` there; host `apps/api/.env` is excluded from the image, so it will not be loaded inside Docker automatically. For local demo data, run `sudo docker compose exec -e SEED_PASSWORD=your-development-password api pnpm auth:seed`, replacing the example password with your chosen development-only value. Do not use a real account password in shell commands.

Accounts: `aram.submitter`, `aram.auditor`, `riyadh.submitter`, `riyadh.auditor`, `admin`.

## 9. Connect your existing Next.js form

At the top of `apps/web/components/login-form.tsx`, add `"use client"` before all imports. Add these imports:

```tsx
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
```

Inside `LoginForm`, before its return, add:

```tsx
const router = useRouter();
const [pending, setPending] = useState(false);
const [error, setError] = useState('');

async function handleSubmit(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
  const values = new FormData(event.currentTarget);
  setPending(true);
  setError('');
  try {
    const response = await fetch('/api/auth/sign-in', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        username: values.get('username'),
        password: values.get('password'),
      }),
    });
    if (!response.ok) {
      setError(response.status === 401
        ? 'Invalid username or password'
        : 'Unable to sign in. Please try again.');
      return;
    }
    router.replace('/'); // Your current app has a home page, not a /dashboard route.
    router.refresh();
  } catch {
    setError('Unable to connect. Please try again.');
  } finally {
    setPending(false);
  }
}
```

Change `<form>` to `<form onSubmit={handleSubmit}>`. Keep the existing username/password inputs with their `name` attributes. Add this inside the form before `FieldGroup`:

```tsx
{error && <p role="alert" className="mb-4 text-sm text-destructive">{error}</p>}
```

Update the submit button:

```tsx
<Button type="submit" disabled={pending}>
  {pending ? 'Signing in…' : 'Login'}
</Button>
```

The browser calls relative `/api` URLs. Your existing rewrite uses `http://localhost:4000` for host development and `http://api:4000` in Compose. Keep that rewrite; no second authentication implementation in Next.js is needed. Do not send tenant IDs or roles as login credentials.

To display the current user in a Client Component, fetch `/api/auth/me`. A 401 means show the login flow; a network failure or 500 should show an error, not pretend the user is signed out. To logout, POST `/api/auth/sign-out`, then navigate to `/login`. The home page is still your existing public UI until you add an authenticated UI; the backend guard protects API data independently.

## 10. Keep authorization separate from authentication

Login answers who a user is. It does not decide which filings they can read or approve. In every tenant-scoped endpoint, load the user using `@CurrentUser()` and derive the tenant filter from that identity. Never trust a browser-provided tenant ID as permission.

For example, a filing read for an ordinary user needs both predicates:

```ts
and(eq(complianceFilings.id, filingId), eq(complianceFilings.tenantId, user.tenantId))
```

Before building this expression, narrow `tenantId` with an explicit null check. Implement system-admin reporting as a separate deliberate permission branch, not by silently dropping the tenant filter whenever `tenantId` is null. Only auditors may perform review actions. Only the global-reporting operations granted by the assessment should bypass company boundaries; being an admin does not automatically grant every mutation.

Use `user.id` for audit actor IDs. Authentication does not itself create compliance audit rows or enforce state transitions; those belong to your filing transaction logic.

## 11. Run and verify

For host development, start PostgreSQL, apply the migration, seed, then run `pnpm dev`. Avoid running host servers on the same ports as Compose app containers.

For Docker, rebuild after dependency changes with `sudo docker compose up --build -d --wait`. Source changes are mounted already. Remember the public health-check decorator. Migrations and seeding are still explicit in your current Compose setup; this tutorial does not silently add automatic bootstrap behavior.

Test through the browser-facing origin, so the same rewrite and cookie path are exercised:

```sh
curl -i -c /tmp/qawaid-cookies.txt   -H 'Content-Type: application/json'   -d '{"username":"aram.submitter","password":"YOUR_LOCAL_SEED_PASSWORD"}'   http://localhost:3000/api/auth/sign-in

curl -i -b /tmp/qawaid-cookies.txt http://localhost:3000/api/auth/me

curl -i -b /tmp/qawaid-cookies.txt -c /tmp/qawaid-cookies.txt   -X POST http://localhost:3000/api/auth/sign-out

curl -i -b /tmp/qawaid-cookies.txt http://localhost:3000/api/auth/me
```

Expect 200 + Set-Cookie, 200 + public user, 204, then 401. Use only your local demo password in commands; do not paste real credentials into shell history or commit cookie files.

Also verify:

- Missing/invalid input gives 400, and bad credentials give 401 without exposing hashes.
- Login's response contains only ID, username, role and tenant ID.
- Login works via the Next.js proxy and the session survives an API restart.
- Logout revokes the database session. A request racing logout cannot re-create it.
- An untrusted cross-origin write gets 403; requests without cookies to protected endpoints get 401.
- Once filing endpoints exist, Tenant A cannot retrieve or mutate Tenant B records, and submitters cannot approve filings.
- Run `pnpm --dir apps/api build`, `pnpm --dir apps/api test`, `pnpm --dir apps/api lint`, and frontend lint/TypeScript checks.

Your project uses Vitest. Write test mocks with `vi.fn()`, not Jest. The installed package also exposes `authenticationStoreContract` from `@nestjs/authentication/testing`; run its sessions contract with concurrency enabled against a separate test database. Its cases use synthetic user IDs, so a test harness for this UUID/FK schema must create corresponding valid user fixtures or map the synthetic IDs. Never truncate your development database to run contract tests.

Before exposing this to real users, add sign-in rate limiting, validate deployment origins, use HTTPS, and run the session-store and tenant-isolation integration tests. This walkthrough intentionally skips sign-up, password recovery, email verification, MFA, mobile JWTs and permission-management UI.

## Reference and verification notes

The current [NestJS authentication guide](https://docs.nestjs.com/security/authentication) describes the first-party authentication package and its session/store extension points. This tutorial narrows the feature set to Qawaid's username login and current PostgreSQL schema. It is not the older Passport/JWT tutorial.

The code above was authored for this repository and checked against the installed package declarations. Backend examples were type-checked in a temporary copy outside your repository; this is not a claim that the endpoints or migrations are already installed or live-tested. No application source files or database records were changed to produce this guide.

## Navigation and mock simplification — November 20

Review work now lives in Filings: auditors default to Pending Review and can select All Filings. Review actions and backend permissions are retained. The separate Review Queue sidebar item is removed; /reviews redirects to /filings. Audit history and verification results remain in the existing drawer.

The mock controller is a simple public POST /mock-registry/verify endpoint, excluded from the /api prefix. It simulates approximately 30% 503 failures and caches successful synthetic results in memory. It does not query filings, require a service secret, or persist mock results. Duplicate keys replay the original result; successful filing results are also reused across attempts. The worker uses the assessment's filing-<uuid>-<attempt> key format. Mock memory resets on restart; durable jobs and saved references remain. This replaces earlier descriptions of a secret-protected, database-backed mock. The old registry_results table is retained only for migration compatibility.
