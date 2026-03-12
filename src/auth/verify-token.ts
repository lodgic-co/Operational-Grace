import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { config, allowedAzpSet } from '../config/index.js';
import { AppError, Unauthenticated } from '../errors/index.js';

const ALLOWED_ALGORITHMS = ['RS256'] as const;
const CLOCK_TOLERANCE_SECONDS = 60;

const jwks = createRemoteJWKSet(new URL(config.AUTH0_JWKS_URI));

export interface ServiceToken extends JWTPayload {
  sub: string;
  azp: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    token: ServiceToken;
    callerServiceId: string;
    errorCode: string | undefined;
    actorUserUuid: string | undefined;
    organisationUuid: string | undefined;
    propertyUuid: string | undefined;
    environment: 'live' | 'training' | undefined;
    startTime: bigint;
    requestId: string;
  }
}

export async function verifyServiceToken(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw Unauthenticated('Authorization header required');
  }

  const jwt = authHeader.slice(7);

  try {
    const { payload } = await jwtVerify(jwt, jwks, {
      issuer: config.AUTH0_ISSUER,
      audience: config.AUTH0_AUDIENCE,
      algorithms: ALLOWED_ALGORITHMS as unknown as string[],
      clockTolerance: CLOCK_TOLERANCE_SECONDS,
    });

    if (!payload.azp) {
      request.log.warn('Token missing azp claim');
      throw Unauthenticated('Token missing azp claim');
    }

    if (!allowedAzpSet.has(payload.azp as string)) {
      request.log.warn({ azp: payload.azp }, 'Token azp not in allowlist');
      throw Unauthenticated('Unauthorized client');
    }

    request.token = payload as ServiceToken;
    request.callerServiceId = payload.azp as string;
  } catch (err) {
    if (err instanceof AppError) {
      throw err;
    }
    request.log.warn({ error_code: 'unauthenticated' }, 'JWT verification failed');
    throw Unauthenticated('Token verification failed');
  }
}
