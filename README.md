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
