import envSchema from 'env-schema';

export const configSchema = {
  type: 'object' as const,
  required: [
    'AUTH0_DOMAIN',
    'AUTH0_AUDIENCE',
    'AUTH0_ALLOWED_AZP',
    'DATABASE_URL',
    'DB_POOL_SIZE',
    'DB_CONNECTION_TIMEOUT_MS',
    'DB_IDLE_TIMEOUT_MS',
    'CURSOR_HMAC_SECRET',
    'MEASURED_JUDGEMENT_BASE_URL',
    'AUTH0_M2M_AUDIENCE',
    'AUTH0_M2M_CLIENT_ID',
    'AUTH0_M2M_CLIENT_SECRET',
    'AUTH0_TOKEN_URL',
  ],
  properties: {
    PORT: { type: 'number' as const, default: 5003 },
    LOG_LEVEL: {
      type: 'string' as const,
      enum: ['silent', 'fatal', 'error', 'warn', 'info', 'debug', 'trace'],
      default: 'info',
    },
    NODE_ENV: {
      type: 'string' as const,
      enum: ['development', 'production', 'test'],
      default: 'development',
    },
    AUTH0_DOMAIN: { type: 'string' as const },
    AUTH0_ISSUER: { type: 'string' as const },
    AUTH0_ISSUER_BASE_URL: { type: 'string' as const },
    AUTH0_AUDIENCE: { type: 'string' as const },
    AUTH0_ALLOWED_AZP: { type: 'string' as const },
    AUTH0_JWKS_URI: { type: 'string' as const },
    JWKS_URL: { type: 'string' as const },
    DATABASE_URL: { type: 'string' as const },
    DB_POOL_SIZE: { type: 'number' as const },
    DB_CONNECTION_TIMEOUT_MS: { type: 'number' as const },
    DB_IDLE_TIMEOUT_MS: { type: 'number' as const },
    CURSOR_HMAC_SECRET: { type: 'string' as const },
    OTEL_EXPORTER_OTLP_ENDPOINT: { type: 'string' as const, default: '' },
    OTEL_SERVICE_NAME: { type: 'string' as const, default: 'operational-grace' },
    MEASURED_JUDGEMENT_BASE_URL: { type: 'string' as const },
    AUTH0_M2M_AUDIENCE: { type: 'string' as const },
    AUTH0_M2M_CLIENT_ID: { type: 'string' as const },
    AUTH0_M2M_CLIENT_SECRET: { type: 'string' as const },
    AUTH0_TOKEN_URL: { type: 'string' as const },
  },
};

export interface AppConfig {
  PORT: number;
  LOG_LEVEL: string;
  NODE_ENV: string;
  AUTH0_DOMAIN: string;
  AUTH0_ISSUER: string;
  AUTH0_AUDIENCE: string;
  AUTH0_ALLOWED_AZP: string;
  AUTH0_JWKS_URI: string;
  DATABASE_URL: string;
  DB_POOL_SIZE: number;
  DB_CONNECTION_TIMEOUT_MS: number;
  DB_IDLE_TIMEOUT_MS: number;
  CURSOR_HMAC_SECRET: string;
  OTEL_EXPORTER_OTLP_ENDPOINT: string;
  OTEL_SERVICE_NAME: string;
  MEASURED_JUDGEMENT_BASE_URL: string;
  AUTH0_M2M_AUDIENCE: string;
  AUTH0_M2M_CLIENT_ID: string;
  AUTH0_M2M_CLIENT_SECRET: string;
  AUTH0_TOKEN_URL: string;
}

/**
 * Parses the comma-separated AZP allowlist into a trimmed, non-empty string array.
 */
export function parseAllowedAzp(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

interface RawConfig {
  AUTH0_ISSUER?: string;
  AUTH0_ISSUER_BASE_URL?: string;
  AUTH0_JWKS_URI?: string;
  JWKS_URL?: string;
  [key: string]: unknown;
}

const deprecationWarnings: string[] = [];

function resolveAlias(
  raw: RawConfig,
  templateName: string,
  legacyName: string,
  label: string,
): string {
  const preferred = raw[templateName] as string | undefined;
  const fallback = raw[legacyName] as string | undefined;

  if (preferred) {
    return preferred;
  }

  if (fallback) {
    deprecationWarnings.push(
      `${legacyName} is deprecated; use ${templateName} instead (currently resolved from ${legacyName} for ${label})`,
    );
    return fallback;
  }

  throw new Error(`Missing required environment variable: ${templateName} (or legacy ${legacyName})`);
}

const raw = envSchema({ schema: configSchema, env: true }) as unknown as RawConfig;

const resolvedIssuer = resolveAlias(raw, 'AUTH0_ISSUER', 'AUTH0_ISSUER_BASE_URL', 'issuer URL');
const resolvedJwksUri = resolveAlias(raw, 'AUTH0_JWKS_URI', 'JWKS_URL', 'JWKS endpoint');

export const config: AppConfig = {
  ...(raw as unknown as AppConfig),
  AUTH0_ISSUER: resolvedIssuer,
  AUTH0_JWKS_URI: resolvedJwksUri,
};

export const allowedAzpSet: ReadonlySet<string> = (() => {
  const list = parseAllowedAzp(config.AUTH0_ALLOWED_AZP);
  if (list.length === 0) {
    throw new Error('AUTH0_ALLOWED_AZP must contain at least one non-empty client ID');
  }
  return new Set(list);
})();

export function emitDeprecationWarnings(log: { warn: (msg: string) => void }): void {
  for (const msg of deprecationWarnings) {
    log.warn(msg);
  }

}
