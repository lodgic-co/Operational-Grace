import type { FastifyRequest, FastifyReply } from 'fastify';
import { config } from '../config/index.js';
import { Unauthenticated } from '../errors/index.js';

export function verifyInternalSecret(
  request: FastifyRequest,
  _reply: FastifyReply,
): void {
  if (config.NODE_ENV !== 'development' && config.NODE_ENV !== 'test') {
    return;
  }

  const secret = config.INTERNAL_SERVICE_SECRET;
  if (!secret) {
    return;
  }

  const header = request.headers['x-internal-secret'];
  if (!header || header !== secret) {
    throw Unauthenticated('Missing or invalid internal service secret');
  }
}
