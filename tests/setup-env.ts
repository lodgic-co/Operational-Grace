import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Align bare `pnpm test` with `scripts/run-local-ci.sh`, which exports `.env.test.local`.
 * When that file exists, DATABASE_URL / DATABASE_URL_DIRECT from it take precedence over
 * unrelated shell exports so tests target the approved local Postgres runtime.
 */
function applyEnvTestLocalIfPresent(): void {
  const p = join(process.cwd(), '.env.test.local');
  if (!existsSync(p)) return;
  const raw = readFileSync(p, 'utf8');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq);
    if (key !== 'DATABASE_URL' && key !== 'DATABASE_URL_DIRECT') continue;
    let v = trimmed.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    process.env[key] = v;
  }
}

applyEnvTestLocalIfPresent();

process.env['AUTH0_DOMAIN'] = 'test.auth0.com';
process.env['AUTH0_ISSUER'] = 'https://test.auth0.com/';
process.env['AUTH0_AUDIENCE'] = 'https://internal.test.example.com/operational-grace';
process.env['AUTH0_ALLOWED_AZP'] = 'polite-intervention-m2m-client-id';
process.env['AUTH0_JWKS_URI'] = 'http://127.0.0.1:19999/.well-known/jwks.json';
process.env['LOG_LEVEL'] = 'silent';
process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] = '';
process.env['OTEL_SERVICE_NAME'] = 'operational-grace-test';
process.env['CURSOR_HMAC_SECRET'] = process.env['CURSOR_HMAC_SECRET'] ?? 'test-cursor-hmac-secret';

// Optional per-service mirrors when a parent process sets OG_DATABASE_URL / OG_DATABASE_URL_DIRECT.
process.env['DATABASE_URL_DIRECT'] =
  process.env['DATABASE_URL_DIRECT'] ?? process.env['OG_DATABASE_URL_DIRECT'];
process.env['DATABASE_URL'] =
  process.env['DATABASE_URL'] ??
  process.env['OG_DATABASE_URL'] ??
  'postgres://lodgic:lodgic@localhost:5432/operational_grace_test?sslmode=disable';

process.env['DB_POOL_SIZE'] = '2';
process.env['DB_CONNECTION_TIMEOUT_MS'] = '3000';
process.env['DB_IDLE_TIMEOUT_MS'] = '5000';
process.env['MEASURED_JUDGEMENT_BASE_URL'] =
  process.env['MEASURED_JUDGEMENT_BASE_URL'] ?? 'https://measured-judgement.internal.test';
process.env['AUTH0_M2M_AUDIENCE'] =
  process.env['AUTH0_M2M_AUDIENCE'] ?? 'https://internal.test.example.com/measured-judgement';
process.env['AUTH0_M2M_AUDIENCE_MEASURED_JUDGEMENT'] =
  process.env['AUTH0_M2M_AUDIENCE_MEASURED_JUDGEMENT'] ?? process.env['AUTH0_M2M_AUDIENCE'];
process.env['AUTH0_M2M_CLIENT_ID'] = process.env['AUTH0_M2M_CLIENT_ID'] ?? 'test-og-m2m-client-id';
process.env['AUTH0_M2M_CLIENT_SECRET'] =
  process.env['AUTH0_M2M_CLIENT_SECRET'] ?? 'test-og-m2m-client-secret';
process.env['AUTH0_TOKEN_URL'] = process.env['AUTH0_TOKEN_URL'] ?? 'https://test.auth0.com/oauth/token';
