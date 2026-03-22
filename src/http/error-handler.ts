import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { trace, SpanStatusCode, context } from '@opentelemetry/api';
import { AppError } from '../errors/index.js';
import { persistTerminalNonSuccessAudit } from '../domain/audit-persist.js';
import {
  mapErrorToTerminalAudit,
  defaultActorForFailure,
  type MappedTerminalAudit,
} from '../domain/audit-terminal.js';

const EXECUTOR_SERVICE = 'operational-grace' as const;

function getActiveTraceId(): string | undefined {
  const span = trace.getSpan(context.active());
  if (!span) return undefined;
  const traceId = span.spanContext().traceId;
  if (traceId === '00000000000000000000000000000000') return undefined;
  return traceId;
}

function inferOgMutationAudit(
  request: FastifyRequest,
  livePool: Pool,
  trainingPool: Pool,
): { pool: Pool; eventName: 'reservation_create' | 'hold_create'; targetType: 'reservation' | 'hold' } | null {
  if (request.method !== 'POST') return null;
  const path = request.url.split('?')[0] ?? request.url;
  const m = path.match(/^\/(live|training)\/properties\/[0-9a-f-]{36}\/(reservations|holds)\/?$/i);
  if (!m) return null;
  const env = m[1]!.toLowerCase();
  const pool = env === 'live' ? livePool : trainingPool;
  if (m[2]!.toLowerCase() === 'reservations') {
    return { pool, eventName: 'reservation_create', targetType: 'reservation' };
  }
  return { pool, eventName: 'hold_create', targetType: 'hold' };
}

async function persistTerminalAuditIfApplicable(
  request: FastifyRequest,
  reqId: string,
  livePool: Pool,
  trainingPool: Pool,
  error: unknown,
  mappedOverride?: MappedTerminalAudit,
): Promise<void> {
  const inferred = inferOgMutationAudit(request, livePool, trainingPool);
  if (!inferred) return;

  const mapped = mappedOverride ?? mapErrorToTerminalAudit(error);
  const actor = defaultActorForFailure({
    actorUserUuid: request.actorUserUuid,
    organisationUuid: request.organisationUuid,
    propertyUuid: request.propertyUuid,
  });
  const now = new Date();
  await persistTerminalNonSuccessAudit(inferred.pool, {
    eventName: inferred.eventName,
    occurredAt: now,
    recordedAt: now,
    actorType: actor.actorType,
    actorUserUuid: actor.actorUserUuid,
    executorService: EXECUTOR_SERVICE,
    organisationUuid: actor.organisationUuid,
    propertyUuid: actor.propertyUuid,
    targetType: inferred.targetType,
    targetUuid: null,
    workId: reqId,
    workKind: 'request',
    outcomeFamily: mapped.outcomeFamily,
    outcome: mapped.outcome,
    reasonCode: mapped.reasonCode,
    metadata: {
      error_code: error instanceof AppError ? error.code : 'internal_error',
    },
  });
}

export function registerRequestId(app: FastifyInstance): void {
  app.decorateRequest('requestId', '');

  app.addHook('onRequest', async (request: FastifyRequest) => {
    const incoming = request.headers['x-request-id'];
    const id =
      typeof incoming === 'string' && incoming.trim().length > 0
        ? incoming.trim()
        : (getActiveTraceId() ?? randomUUID());
    request.requestId = id;

    const span = trace.getSpan(context.active());
    if (span) {
      span.setAttribute('app.request_id', id);
    }
  });
}

export function registerCorrelationHeader(app: FastifyInstance): void {
  app.addHook('onSend', async (request: FastifyRequest, reply: FastifyReply) => {
    const traceId = getActiveTraceId();
    const value = traceId ?? request.requestId ?? request.id;
    reply.header('x-request-id', value);
  });
}

export interface RegisterErrorHandlerOptions {
  livePool: Pool;
  trainingPool: Pool;
}

export function registerErrorHandler(app: FastifyInstance, opts: RegisterErrorHandlerOptions): void {
  const { livePool, trainingPool } = opts;

  app.setErrorHandler(async (error: Error, request: FastifyRequest, reply: FastifyReply) => {
    const reqId = request.requestId || request.id;

    const span = trace.getSpan(context.active());

    if (error instanceof AppError) {
      request.errorCode = error.code;

      if (span) {
        span.setAttribute('error.code', error.code);
        if (error.status >= 500) {
          span.recordException(error);
          span.setStatus({ code: SpanStatusCode.ERROR, message: error.code });
        }
      }

      try {
        await persistTerminalAuditIfApplicable(request, reqId, livePool, trainingPool, error);
      } catch (auditErr) {
        request.log.error({ err: auditErr }, 'terminal_audit_persist_failed');
        return reply.code(500).send({
          error: {
            status: 500,
            code: 'internal_error',
            message: 'Internal server error',
            request_id: reqId,
            retryable: false,
          },
        });
      }

      return reply.code(error.status).send(error.toEnvelope(reqId));
    }

    const fastifyStatusCode = (error as { statusCode?: number }).statusCode;
    if (typeof fastifyStatusCode === 'number' && fastifyStatusCode >= 400 && fastifyStatusCode < 500) {
      request.errorCode = 'invalid_request';
      request.log.warn({ err: error }, 'client_error');
      try {
        await persistTerminalAuditIfApplicable(request, reqId, livePool, trainingPool, error, {
          outcomeFamily: 'rejection',
          outcome: 'rejected',
          reasonCode: 'invalid_request',
        });
      } catch (auditErr) {
        request.log.error({ err: auditErr }, 'terminal_audit_persist_failed');
        return reply.code(500).send({
          error: {
            status: 500,
            code: 'internal_error',
            message: 'Internal server error',
            request_id: reqId,
            retryable: false,
          },
        });
      }
      return reply.code(fastifyStatusCode).send({
        error: {
          status: fastifyStatusCode,
          code: 'invalid_request',
          message: error.message,
          request_id: reqId,
          retryable: false,
        },
      });
    }

    request.errorCode = 'internal_error';
    request.log.error({ err: error }, 'unhandled_error');

    if (span) {
      span.recordException(error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: 'internal_error' });
      span.setAttribute('error.code', 'internal_error');
    }

    try {
      await persistTerminalAuditIfApplicable(request, reqId, livePool, trainingPool, error);
    } catch (auditErr) {
      request.log.error({ err: auditErr }, 'terminal_audit_persist_failed');
      return reply.code(500).send({
        error: {
          status: 500,
          code: 'internal_error',
          message: 'Internal server error',
          request_id: reqId,
          retryable: false,
        },
      });
    }

    return reply.code(500).send({
      error: {
        status: 500,
        code: 'internal_error',
        message: 'Internal server error',
        request_id: reqId,
        retryable: false,
      },
    });
  });
}
