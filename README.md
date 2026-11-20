# Qawaid

Next.js frontend in `apps/web`, NestJS backend in `apps/api`.

## Filing audit history

Open **Filings** (`/filings`) and select a filing row to open its **Audit History** drawer. The drawer shows status transitions, timestamps, actor usernames, rejection reasons, and edit before/after values. Approved filings also show persisted registry verification status, attempts, errors, and their external reference.

Audit history is available through the filings drawer. The standalone `/audit-history` page and its sidebar link have been removed. The drawer continues to load events from `GET /api/filings/:id/audit-history`.

## Development

Use Node.js 22.12+ (Node.js 24 LTS recommended) and pnpm 10.26.0.

```sh
pnpm install
pnpm dev
```

Open http://localhost:3000. Nest runs on http://localhost:4000 with the `/api` prefix. Browser requests to `/api` on port 3000 are forwarded to Nest. Stop both with Ctrl+C.

Run one app with `pnpm --dir apps/web dev` or `pnpm --dir apps/api start:dev`.

## Build

```sh
pnpm build
```

Set `API_URL` for the web build and runtime to the backend origin in production. It defaults to `http://localhost:4000` locally. Next.js rewrites are configured at build time.

## Local PostgreSQL and Drizzle

PostgreSQL can run alongside host development servers, or all three services can run in Compose as described below.

### Install Docker (Ubuntu)

If Docker Engine and its Compose plugin are not installed:

```sh
bash scripts/install-docker-ubuntu.sh
```

The script uses Docker's official Ubuntu apt repository and asks for your sudo password. Docker commands below require Docker socket access. If your user does not have it, use `sudo docker compose up -d --wait postgres` instead of `pnpm db:up`. See [Docker's post-install instructions](https://docs.docker.com/engine/install/linux-postinstall/) for optional user access.

### Start the database and apps

Local `.env` files have been created with a matching randomly generated database password. For a fresh checkout, copy `.env.example` to `.env` and `apps/api/.env.example` to `apps/api/.env`, then replace the password in both files with the same value (URL-encode it in `DATABASE_URL` if needed). Never commit these files.

```sh
pnpm install
pnpm db:up
pnpm dev
```

- PostgreSQL: `127.0.0.1:5432`, database/user `qawaid` by default.
- NestJS reads `apps/api/.env`; Next.js never receives the database credentials.
- Verify the connection: `curl http://localhost:3000/api/health/database` (or port 4000 directly). A working connection returns `{"status":"ok","database":"postgresql"}`; an unavailable database returns HTTP 503.
- View logs: `pnpm db:logs`.
- Stop PostgreSQL only: `pnpm db:down`. The named volume retains your data.
- Open SQL: `docker compose exec postgres psql -U qawaid -d qawaid`.

The image uses PostgreSQL 18 with its data volume mounted at `/var/lib/postgresql`. Changing initialization credentials in `.env` does not change an existing database's password; update the role through SQL and keep the API connection URL in sync.

### Define and migrate tables

Export Drizzle table definitions from `apps/api/src/database/schema.ts`. The schema defines tenants, compliance filings, audit logs, and the filing status enum. The initial migration is `apps/api/drizzle/0000_compliance_schema.sql`.

```sh
pnpm db:generate   # Generate SQL migrations after adding/changing tables
pnpm db:migrate    # Apply generated migrations to the running database
pnpm db:studio    # Inspect your local database
```

Commit generated files under `apps/api/drizzle/`. For disposable local schema experiments, `pnpm db:push` applies schema changes directly; review its prompts carefully. Host development requires `pnpm db:migrate` before starting the API. Compose applies migrations and runs the rerunnable demo seed automatically before starting NestJS.

Inject the connection in a Nest provider using `@InjectDrizzle()` from `@nestjs/drizzle` and type it as `NodePgDatabase<typeof schema>`. See `DatabaseController` for a working query. Database pools close through the Nest lifecycle when the app shuts down.

References: [NestJS Drizzle integration](https://docs.nestjs.com/data/drizzle), [Drizzle PostgreSQL setup](https://orm.drizzle.team/docs/get-started/postgresql-new), [PostgreSQL image](https://hub.docker.com/_/postgres).


## Run the whole app in Docker (development)

From the repository root:

```sh
sudo docker compose up --build -d --wait
```

Open http://localhost:3000. Next.js runs on port 3000, NestJS on port 4000, and PostgreSQL on port 5432. Stop any host development servers first to free these ports. PostgreSQL starts first; NestJS waits for readiness, applies migrations, seeds demo accounts/sample filings, then starts. Next.js waits for the API database health check. The first image build downloads Node.js and installs the workspace dependencies.

Compose loads database credentials from the root `.env`. Inside Docker, Nest connects to `postgres:5432` and Next.js proxies `/api` to `api:4000`. The browser continues to call `/api` on localhost:3000. No database credentials are passed to Next.js.

Source folders are mounted for hot reload. Dependencies and generated build output stay inside the containers. After changing package dependencies, update `pnpm-lock.yaml` with `pnpm install`, then rerun the command with `--build`. If you add a new top-level source folder, add its mount to `compose.yaml`.

```sh
sudo docker compose logs -f             # Follow all logs
sudo docker compose ps                 # Service status
sudo docker compose down               # Stop everything; database data remains
sudo docker compose exec api pnpm db:generate
sudo docker compose exec api pnpm db:migrate
```

Generated migration files are mounted back into `apps/api/drizzle`. Container-generated files may be owned by root on Linux. This setup runs development servers; production deployments should use separate optimized production images.

If your user has Docker access, omit `sudo` or use `pnpm docker:up`, `pnpm docker:down`, and `pnpm docker:logs`.


### Package scripts for Docker

Run these from the repository root:

| Command | Action |
| --- | --- |
| `pnpm docker:up` | Build and start the entire stack |
| `pnpm docker:start` | Start the stack using existing images |
| `pnpm docker:stop` | Stop the stack, keeping containers and database data |
| `pnpm docker:down` | Remove stack containers, keeping database data |
| `pnpm docker:restart` | Restart existing containers |
| `pnpm docker:build` | Build application images |
| `pnpm docker:status` | Show service status |
| `pnpm docker:logs` | Follow logs from all services |
| `pnpm docker:db:generate` | Generate migrations inside the running API container |
| `pnpm docker:db:migrate` | Apply migrations inside the running API container |
| `pnpm docker:db:push` | Apply schema changes directly inside the running API container |

These scripts require Docker socket access for your user. If Docker requires sudo, use the corresponding `sudo docker compose ...` commands above. `docker:restart` does not rebuild images; use `docker:up` after dependency changes.

## Demo accounts and sample data

Compose reads `SEED_PASSWORD` from the root `.env` (development default: `temporary-dev-password`, at least 12 characters). Seeded usernames:

- `aram.submitter`, `aram.auditor`
- `riyadh.submitter`, `riyadh.auditor`
- `admin` (read-only global reporting)

The seed creates two companies and ten sample filings spanning all five lifecycle states, with representative audit histories. It is safe to rerun: existing passwords and filings are preserved. Changing SEED_PASSWORD does not reset existing passwords. For host development, run `SEED_PASSWORD=temporary-dev-password pnpm --dir apps/api auth:seed` after migrations.

## Workflow and access

Submitters create/edit their own company drafts and submit them. Company auditors start review and approve or reject; rejection requires a trimmed, non-empty reason. APPROVED and REJECTED are final. Review assignment records an auditor; the audit actor identifies each person who acted. Same-company auditors can review independently of who started the review.

Every write checks role and tenant in NestJS. Submitter writes additionally check creator ownership. Actual UPDATE predicates include the allowed current status and expected version; successful writes increment the version in PostgreSQL. An illegal transition returns 400; a stale/conflicting verdict returns 409. Audit events commit in the same transaction. Admins have cross-company read access, including dashboard totals, but cannot mutate or review filings.

The header Arabic/English toggle changes document language/direction, sidebar side, table alignment, and Arabic typography. It provides RTL/LTR support, not a full translation of all English interface copy.

Submission uses React Hook Form with Zod in the validated modal. Company name/registration are read-only and server-controlled; the backend checks any supplied registration against the authenticated company. Categories are non-empty labels up to 50 characters because the brief supplies no category enumeration. Dates use validated calendar YYYY-MM-DD values; the brief does not forbid expired licenses automatically.

## Registry verification

Approval inserts a `registry_jobs` row in the same transaction as the decision and audit. A Nest lifecycle worker polls PostgreSQL every 500 ms and calls `POST /mock-registry/verify`. The mock is excluded from the `/api` prefix to match the assignment. It is public and only creates simulated in-memory results; it cannot read or modify company filings.

The mock uses `Math.random() < 0.3` to simulate 503 failures on new validations. Successful results are remembered in a simple in-memory Map. Repeating a request returns its original reference; a successful filing result is reused across attempts. The worker sends `Idempotency-Key: filing-<uuid>-<attempt>` as shown in the assessment. Mock memory resets when the API restarts; durable worker jobs and saved filing references remain in PostgreSQL. The previous registry_results table is retained for migration compatibility but is no longer used by the mock.

There are four attempts total: the initial call plus retries after 1, 2, and 4 seconds (plus polling delay). Network errors/timeouts, 408, 429, and 5xx are retryable; other HTTP failures stop immediately. Calls time out after five seconds. Exhaustion saves FAILED and a display-safe error without reversing internal approval.

Workers claim jobs atomically using PostgreSQL `FOR UPDATE SKIP LOCKED` and a 30-second lease token; expired claims can be recovered after crashes. Job updates check the lease token to prevent stale workers overwriting a newer result. Successful verification adds the external reference as registry metadata; it does not reopen or change the final review decision. Existing approvals are backfilled by migration 0005. Inspect verification in the filing drawer; reload to see background changes.

## Verification commands

```sh
pnpm test                         # API unit/SQL-mock tests
pnpm check                        # API + frontend TypeScript
pnpm --dir apps/web lint
pnpm --dir apps/api lint
pnpm build
RUN_DATABASE_TESTS=1 pnpm test:integration
```

The opt-in integration suite builds Nest, creates a uniquely named temporary PostgreSQL database, applies all migrations, starts a real HTTP API, and removes its database afterward. The configured database role needs CREATE DATABASE permission. It does not use your existing application filings. It checks sessions/roles/tenants, the lifecycle, rejection validation, concurrent verdicts, real audit rollback, async retry/idempotency results, retry exhaustion/lease recovery, and rerunnable sample seeding. Without RUN_DATABASE_TESTS=1, the integration suite is skipped.

For delivery, copy `.env.example` to `.env`, set local passwords, and run `pnpm docker:up` (or `sudo docker compose up --build -d --wait` if required). `docker compose config --quiet` validates configuration without starting Docker. Never use `down -v` unless you intend to erase the local database.

## Filing and review navigation

Review work is merged into `/filings`. Auditors default to **Pending Review** and can select **All Filings** for finalized records. Submitters see their own filings; admins see global read-only results. Review actions, audit history, and registry results use the existing table/drawer. `/reviews` redirects to `/filings` for old bookmarks; there is no separate Review Queue sidebar item.
