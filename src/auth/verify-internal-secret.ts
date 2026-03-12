import type { FastifyRequest, FastifyReply } from 'fastify';
import { config } from '../config/index.js';
import { Unauthenticated } from '../errors/index.js';

/**
 * Dev/test-only internal secret check.
 *
 * Returns true when the request is authenticated via the internal service
 * secret, allowing app.ts to skip JWT verification for internal callers
 * (e.g. during integration tests or local development before network
 * isolation is in place). Sets request.callerServiceId = 'internal' so
 * the canonical completion log carries a caller identity.
 *
 * Returns false when the check is not active (production, or no secret
 * configured). The caller must then run verifyServiceToken.
 */
export function verifyInternalSecret(
  request: FastifyRequest,
  _reply: FastifyReply,
): boolean {
  if (config.NODE_ENV !== 'development' && config.NODE_ENV !== 'test') {
    return false;
  }

  const secret = config.INTERNAL_SERVICE_SECRET;
  if (!secret) {
    return false;
  }

  const header = request.headers['x-internal-secret'];
  const value = Array.isArray(header) ? header[0] : header;

  if (!value || value !== secret) {
    throw Unauthenticated('Missing or invalid X-Internal-Secret');
  }

  request.callerServiceId = 'internal';
  return true;
}
