# operational-grace

Internal domain service for reservations. Owns reservations and guests within the Lodgic platform.

This service is not publicly reachable. All external traffic arrives via `polite-intervention`.

## Domain ownership

- Reservations
- Guests (planned)

Not in scope: payments, receipting (owned by separate future services).

## Stack

- Node.js 20 LTS, TypeScript (strict mode), pnpm
- Fastify, Zod, PostgreSQL (`pg`), `node-pg-migrate`
- OpenTelemetry, Auth0 M2M JWT authentication

## Environments

The service exposes two explicit URL namespaces per endpoint:

- `/live/...` — queries `operational_grace` schema (live data)
- `/training/...` — queries `operational_grace_training` schema (training data)

Both schemas share the same database connection string but use isolated PostgreSQL schemas with `search_path` set per pool connection.

## Local setup

```bash
pnpm install
cp .env.example .env
# Edit .env with your local database URL and Auth0 credentials
```

Start a local PostgreSQL database, then run migrations:

```bash
pnpm migrate
```

Start the service:

```bash
pnpm dev
```

## Migrations

Migrations are managed by `node-pg-migrate` and must **not** run automatically at service startup.

To run migrations against both live and training schemas:

```bash
pnpm migrate
```

This requires `DATABASE_URL_DIRECT` (a direct, non-pooled connection string). Migrations run sequentially against `operational_grace` then `operational_grace_training`, each with its own migration tracking table.

To add a new migration:

```bash
pnpm migrate:create <migration-name>
```

## Environment variables

See `.env.example` for the full list. Required variables at startup:

| Variable | Description |
|---|---|
| `AUTH0_DOMAIN` | Auth0 domain for JWKS discovery |
| `AUTH0_AUDIENCE` | JWT audience for this service |
| `AUTH0_ALLOWED_AZP` | Comma-separated allowlist of permitted caller `azp` claim values |
| `DATABASE_URL` | PostgreSQL connection string (pooled) |
| `CURSOR_HMAC_SECRET` | Secret for HMAC-SHA256 cursor signing |
| `MEASURED_JUDGEMENT_BASE_URL` | Base URL of the measured-judgement service |
| `AUTH0_M2M_AUDIENCE` | Audience when requesting M2M tokens to call measured-judgement |
| `AUTH0_M2M_CLIENT_ID` | Client ID for outbound M2M token requests |
| `AUTH0_M2M_CLIENT_SECRET` | Client secret for outbound M2M token requests |
| `AUTH0_TOKEN_URL` | Auth0 token endpoint |

## Testing

Unit tests (no database required):

```bash
pnpm test:unit
```

Integration tests (requires a running PostgreSQL database with migrations applied):

```bash
pnpm test:integration
```

## Health endpoints

- `GET /health/live` — liveness probe; always 200 when process is up
- `GET /health/ready` — readiness probe; checks connectivity to both live and training database pools

## Authentication

Inbound requests must carry an Auth0 M2M Bearer token whose `azp` claim is in `AUTH0_ALLOWED_AZP`. Outbound calls to `measured-judgement` use a separate M2M token obtained via the client-credentials grant.

In `development` and `test` environments, `X-Internal-Secret` can substitute for a Bearer token (temporary — will be removed once network isolation is in place).
