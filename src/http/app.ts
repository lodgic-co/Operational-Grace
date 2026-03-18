import Fastify from 'fastify';
import type { Pool } from 'pg';
import { trace } from '@opentelemetry/api';
import type { Span } from '@opentelemetry/api';
import { loggerOptions } from '../observability/logger.js';
import { healthRoutes } from '../routes/health.js';
import { internalRoutes } from '../routes/internal.js';
import { reservationRoutes } from '../routes/reservations.js';
import { holdRoutes } from '../routes/holds.js';
import { bundleRoutes } from '../routes/bundles.js';
import { verifyServiceToken } from '../auth/verify-token.js';
import { registerRequestId, registerCorrelationHeader, registerErrorHandler } from './error-handler.js';
import type { MeasuredJudgementClient } from './measured-judgement-client.js';

declare module 'fastify' {
  interface FastifyRequest {
    inboundSpan: Span | null;
  }
}

export interface CreateAppOptions {
  mjClient: MeasuredJudgementClient;
  livePool: Pool;
  trainingPool: Pool;
  capabilityAllowlistMap?: ReadonlyMap<string, ReadonlySet<string>>;
}

export function createApp(opts: CreateAppOptions) {
  const app = Fastify({ logger: loggerOptions, disableRequestLogging: true });

  registerRequestId(app);
  registerCorrelationHeader(app);
  registerErrorHandler(app);

  app.register(healthRoutes);
  app.register(internalRoutes);

  if (!opts.livePool || !opts.trainingPool || !opts.mjClient) {
    throw new Error(
      'operational-grace: livePool, trainingPool, and mjClient are all required. ' +
      'Reservation routes cannot be registered without all three. ' +
      'Check environment configuration and ensure both database schema pools are initialised.',
    );
  }

  const { livePool, trainingPool, mjClient, capabilityAllowlistMap } = opts;

  app.register(
    (f) => reservationRoutes(f, { environment: 'live', livePool, trainingPool, mjClient }),
    { prefix: '/live' },
  );
  app.register(
    (f) => reservationRoutes(f, { environment: 'training', livePool, trainingPool, mjClient }),
    { prefix: '/training' },
  );

  app.register(
    (f) => holdRoutes(f, { environment: 'live', livePool, trainingPool, mjClient }),
    { prefix: '/live' },
  );
  app.register(
    (f) => holdRoutes(f, { environment: 'training', livePool, trainingPool, mjClient }),
    { prefix: '/training' },
  );

  if (capabilityAllowlistMap) {
    app.register((f) =>
      bundleRoutes(f, { livePool, trainingPool, capabilityAllowlistMap }),
    );
  }

  app.decorateRequest('startTime', BigInt(0));
  app.decorateRequest('inboundSpan', null);
  app.decorateRequest('callerServiceId', '');
  app.decorateRequest('errorCode', undefined);
  app.decorateRequest('actorUserUuid', undefined);
  app.decorateRequest('organisationUuid', undefined);
  app.decorateRequest('propertyUuid', undefined);
  app.decorateRequest('environment', undefined);

  app.addHook('onRequest', async (request, reply) => {
    request.startTime = process.hrtime.bigint();
    request.inboundSpan = trace.getActiveSpan() ?? null;

    if (!request.url.startsWith('/health')) {
      request.log.info(
        { request_id: request.requestId, method: request.method, path: request.url },
        'incoming_request',
      );
      await verifyServiceToken(request, reply);
    }
  });

  app.addHook('onResponse', (request, reply, done) => {
    if (request.url.startsWith('/health')) {
      done();
      return;
    }

    const durationNs = Number(process.hrtime.bigint() - request.startTime);
    const durationMs = Math.round((durationNs / 1e6) * 100) / 100;

    const log: Record<string, unknown> = {
      request_id: request.requestId,
      method: request.method,
      path: request.url,
      status_code: reply.statusCode,
      duration_ms: durationMs,
    };
    if (request.callerServiceId) log.caller_service_id = request.callerServiceId;
    if (request.errorCode) log.error_code = request.errorCode;
    if (request.actorUserUuid) log.actor_user_uuid = request.actorUserUuid;
    if (request.organisationUuid) log.organisation_uuid = request.organisationUuid;
    if (request.propertyUuid) log.property_uuid = request.propertyUuid;
    if (request.environment) log.environment = request.environment;

    request.log.info(log, 'request_completed');
    done();
  });

  return app;
}
