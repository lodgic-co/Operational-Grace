import { trace, context, type Span } from '@opentelemetry/api';
import { config } from '../config/index.js';
import { BadGateway, GatewayTimeout } from '../errors/index.js';
import { fetchOutbound } from './outbound-dispatcher.js';

const REQUEST_TIMEOUT_MS = 5000;
const MAX_RETRIES = 2;
const BASE_DELAY_MS = 100;
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
    audience: config.AUTH0_M2M_AUDIENCE_MEASURED_JUDGEMENT,
  });

  const response = await fetchOutbound(config.AUTH0_TOKEN_URL, {
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

function jitter(): number {
  return Math.floor(Math.random() * 50);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function doFetch(
  url: string,
  options: Omit<RequestInit, 'signal'>,
  inboundSpan?: Span | null,
): Promise<Response> {
  // Rebuild propagation context from the stored inbound span immediately before
  // dispatch. context.with ensures the correct parent span is active only during
  // this outbound call, guarding against ambient async context drift caused by
  // earlier async work such as token acquisition.
  const ctx = inboundSpan
    ? trace.setSpan(context.active(), inboundSpan)
    : context.active();

  return context.with(ctx, () =>
    fetchOutbound(url, {
      ...options,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }),
  );
}

async function fetchWithRetry(
  url: string,
  options: Omit<RequestInit, 'signal'>,
  inboundSpan?: Span | null,
  attempt = 0,
): Promise<Response> {
  let response: Response;
  try {
    response = await doFetch(url, options, inboundSpan);
  } catch (err) {
    if ((err as Error).name === 'TimeoutError') {
      if (attempt < MAX_RETRIES) {
        await sleep(BASE_DELAY_MS * Math.pow(2, attempt) + jitter());
        return fetchWithRetry(url, options, inboundSpan, attempt + 1);
      }
      throw GatewayTimeout('measured-judgement request timed out');
    }
    throw err;
  }

  if (response.status >= 500 && attempt < MAX_RETRIES) {
    await sleep(BASE_DELAY_MS * Math.pow(2, attempt) + jitter());
    return fetchWithRetry(url, options, inboundSpan, attempt + 1);
  }

  return response;
}

async function buildHeaders(requestId?: string): Promise<Record<string, string>> {
  const token = await acquireMjToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Authorization: `Bearer ${token}`,
  };

  if (requestId) {
    headers['X-Request-Id'] = requestId;
  }

  return headers;
}

export interface MeasuredJudgementClient {
  checkPermission(
    actorUserUuid: string,
    organisationUuid: string,
    permissionKey: string,
    propertyUuids?: string[],
    requestId?: string,
    inboundSpan?: Span | null,
  ): Promise<{ allowed: boolean }>;
}

export function createMeasuredJudgementClient(baseUrl: string): MeasuredJudgementClient {
  async function checkPermission(
    actorUserUuid: string,
    organisationUuid: string,
    permissionKey: string,
    propertyUuids?: string[],
    requestId?: string,
    inboundSpan?: Span | null,
  ): Promise<{ allowed: boolean }> {
    const body: Record<string, unknown> = {
      actor_user_uuid: actorUserUuid,
      organisation_uuid: organisationUuid,
      permission_key: permissionKey,
    };

    if (propertyUuids && propertyUuids.length > 0) {
      body.property_uuids = propertyUuids;
    }

    const response = await fetchWithRetry(
      `${baseUrl}/permissions/check`,
      {
        method: 'POST',
        headers: await buildHeaders(requestId),
        body: JSON.stringify(body),
      },
      inboundSpan,
    );

    if (!response.ok) {
      throw BadGateway(`measured-judgement permission check failed: ${response.status}`);
    }

    const data = (await response.json()) as { allowed: boolean };
    return { allowed: data.allowed };
  }

  return { checkPermission };
}
