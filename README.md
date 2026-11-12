# Qawaid

Next.js frontend in `apps/web`, NestJS backend in `apps/api`.

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

PostgreSQL runs in Docker; Next.js and NestJS run on your host with hot reload.

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
- Stop PostgreSQL: `pnpm db:down`. The named volume retains your data.
- Open SQL: `docker compose exec postgres psql -U qawaid -d qawaid`.

The image uses PostgreSQL 18 with its data volume mounted at `/var/lib/postgresql`. Changing initialization credentials in `.env` does not change an existing database's password; update the role through SQL and keep the API connection URL in sync.

### Define and migrate tables

Export Drizzle table definitions from `apps/api/src/database/schema.ts`. The initial schema is intentionally empty until the app's data model is defined.

```sh
pnpm db:generate   # Generate SQL migrations after adding/changing tables
pnpm db:migrate    # Apply generated migrations to the running database
pnpm db:studio    # Inspect your local database
```

Commit generated files under `apps/api/drizzle/`. For disposable local schema experiments, `pnpm db:push` applies schema changes directly; review its prompts carefully. Migrations run explicitly, rather than automatically during app startup.

Inject the connection in a Nest provider using `@InjectDrizzle()` from `@nestjs/drizzle` and type it as `NodePgDatabase<typeof schema>`. See `DatabaseController` for a working query. Database pools close through the Nest lifecycle when the app shuts down.

References: [NestJS Drizzle integration](https://docs.nestjs.com/data/drizzle), [Drizzle PostgreSQL setup](https://orm.drizzle.team/docs/get-started/postgresql-new), [PostgreSQL image](https://hub.docker.com/_/postgres).
