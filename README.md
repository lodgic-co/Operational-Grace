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
pnpm db:migrate
```

Start the service:

```bash
pnpm dev
```

## Migrations

Migrations are managed by `node-pg-migrate` and must **not** run automatically at service startup.

To run migrations against both live and training schemas:

```bash
pnpm db:migrate
```

This requires `DATABASE_URL_DIRECT` (a direct, non-pooled connection string). Migrations run sequentially against `operational_grace` then `operational_grace_training`, each with its own migration tracking table.

To add a new migration:

```bash
pnpm db:create-migration <migration-name>
```

## Observability

OpenTelemetry is enabled when `OTEL_EXPORTER_OTLP_ENDPOINT` is set.

Production startup from `package.json` is:

```bash
pnpm start
```

This runs `node --import ./dist/observability/otel-preload.js dist/index.js`, so the preload activates the OTel SDK before the app entrypoint loads.

Default development startup from `package.json` is:

```bash
pnpm dev
```

This runs `tsx watch src/index.ts` and does **not** preload `src/observability/otel-preload.ts`.

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
pnpm test
```

The repository currently exposes a single `pnpm test` command rather than separate `test:unit` and `test:integration` scripts.

## Health endpoints

- `GET /health/live` — liveness probe; always 200 when process is up
- `GET /health/ready` — readiness probe; checks connectivity to both live and training database pools

## Authentication

Inbound requests must carry an Auth0 M2M Bearer token whose `azp` claim is in `AUTH0_ALLOWED_AZP`. Outbound calls to `measured-judgement` use a separate M2M token obtained via the client-credentials grant.

## Delegated Actor Context

Every inbound request must include the following delegated actor headers, forwarded by `polite-intervention`:

| Header | Required | Description |
|---|---|---|
| `X-Actor-Type` | Yes | Must be `user`. All other actor types are rejected with `400 invalid_request`. |
| `X-Actor-User-Uuid` | Yes | UUID of the authenticated user. |
| `X-Organisation-Uuid` | Yes | Organisation UUID that the request is scoped to. |
| `X-Property-Uuid` | Yes | Property UUID that the request is scoped to. Must match the `:property_uuid` path parameter; mismatches return `400 invalid_request`. |
| `X-Request-Id` | No | Optional inbound correlation. When present, propagated as Audit v2 `work_id` (with `work_kind` `request`) for mutation routes and echoed on responses; when absent, derived from trace context or a new UUID. |

**Actor type constraint:** This service hard-rejects any actor type other than `user`. Service, system, and anonymous actors are not permitted.

**Header consistency check:** The `X-Property-Uuid` header value is validated against the `:property_uuid` path parameter on every request. This prevents cross-property access via header spoofing.

## Permission Enforcement

`operational-grace` does not trust the delegated actor context alone. For reservation read endpoints, it calls `measured-judgement` to verify that the actor holds the required permission before returning data.

**Permission checked:** `reservations.view`

**Enforcement flow:**

1. Parse and validate delegated actor context headers.
2. Call `POST /permissions/check` on `measured-judgement` with `{ actor_user_uuid, organisation_uuid, permission_key: "reservations.view", property_uuids: [property_uuid] }`.
3. On permission denial, return `404 not_found` (non-leakage: indistinguishable from not found).
4. On grant, proceed with the reservation query.

`measured-judgement` is the authoritative permission authority. This service does not maintain local permission tables or role data.

## Audit (Audit v2)

This service persists **terminal audit** rows for reservation and hold mutations in the local `audit_event` table (live and training schemas). Success-path rows are written in the same transaction as domain commits; rejection and failure outcomes use a separate committed transaction before the HTTP response, per platform rule I19 and `rules/platform-rules/contracts/audit-event-v2.yaml`. This is **not** a domain data store — it records outcomes only.
