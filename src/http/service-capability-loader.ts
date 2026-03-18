import { config } from '../config/index.js';

const REQUEST_TIMEOUT_MS = 5000;
const TOKEN_EXPIRY_BUFFER_SECONDS = 60;

let cachedToken: string | null = null;
let tokenExpiresAt = 0;

async function acquireMjToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && tokenExpiresAt > now + TOKEN_EXPIRY_BUFFER_SECONDS) {
    return cachedToken;
  }

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: config.AUTH0_M2M_CLIENT_ID,
    client_secret: config.AUTH0_M2M_CLIENT_SECRET,
    audience: config.AUTH0_M2M_AUDIENCE,
  });

  const response = await fetch(config.AUTH0_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(5000),
  });

  if (!response.ok) {
    throw new Error(`M2M token exchange for measured-judgement failed: ${response.status}`);
  }

  const data = (await response.json()) as { access_token: string; expires_in: number };
  cachedToken = data.access_token;
  tokenExpiresAt = now + data.expires_in;
  return cachedToken;
}

/**
 * Loads service capability grants for this service from MJ at startup.
 * Builds and returns an immutable Map<capability_key, Set<caller_service_id>>.
 *
 * Throws if MJ is unreachable — owning service must fail fast.
 */
export async function loadCapabilityAllowlistMap(
  owningService: string,
): Promise<ReadonlyMap<string, ReadonlySet<string>>> {
  const token = await acquireMjToken();

  const url = new URL('/service-authorities/grants', config.MEASURED_JUDGEMENT_BASE_URL);
  url.searchParams.set('owning_service', owningService);

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(
      `Failed to load service capability grants from MJ: ${response.status}`,
    );
  }

  const data = (await response.json()) as {
    grants: Array<{ capability_key: string; caller_service_id: string }>;
  };

  const map = new Map<string, Set<string>>();
  for (const grant of data.grants) {
    const existing = map.get(grant.capability_key);
    if (existing) {
      existing.add(grant.caller_service_id);
    } else {
      map.set(grant.capability_key, new Set([grant.caller_service_id]));
    }
  }

  return map as ReadonlyMap<string, ReadonlySet<string>>;
}
