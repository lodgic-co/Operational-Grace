import { AppError } from '../errors/index.js';
import type { AuditActorType } from './audit-persist.js';

export type MappedTerminalAudit = {
  outcomeFamily: 'rejection' | 'failure';
  outcome: 'rejected' | 'failed';
  reasonCode: string;
};

/**
 * Pure mapping from application errors to governed reason_code / outcome (audit-event-v2 contract).
 */
export function mapErrorToTerminalAudit(error: unknown): MappedTerminalAudit {
  if (error instanceof AppError) {
    if (error.status === 401) {
      return { outcomeFamily: 'failure', outcome: 'failed', reasonCode: 'authentication_failed' };
    }
    if (error.status === 404) {
      return { outcomeFamily: 'rejection', outcome: 'rejected', reasonCode: 'not_allowed' };
    }
    if (error.status === 400) {
      return { outcomeFamily: 'rejection', outcome: 'rejected', reasonCode: 'invalid_request' };
    }
    if (error.status === 409) {
      return { outcomeFamily: 'rejection', outcome: 'rejected', reasonCode: 'overlap' };
    }
    if (error.status === 502) {
      return { outcomeFamily: 'failure', outcome: 'failed', reasonCode: 'upstream_unavailable' };
    }
    if (error.status === 504) {
      return { outcomeFamily: 'failure', outcome: 'failed', reasonCode: 'upstream_timeout' };
    }
    if (error.status >= 500) {
      return { outcomeFamily: 'failure', outcome: 'failed', reasonCode: 'internal_error' };
    }
    return { outcomeFamily: 'rejection', outcome: 'rejected', reasonCode: 'not_allowed' };
  }
  return { outcomeFamily: 'failure', outcome: 'failed', reasonCode: 'internal_error' };
}

export function defaultActorForFailure(request: {
  actorUserUuid?: string;
  organisationUuid?: string;
  propertyUuid?: string;
}): { actorType: AuditActorType; actorUserUuid: string | null; organisationUuid: string | null; propertyUuid: string | null } {
  if (request.actorUserUuid) {
    return {
      actorType: 'user',
      actorUserUuid: request.actorUserUuid,
      organisationUuid: request.organisationUuid ?? null,
      propertyUuid: request.propertyUuid ?? null,
    };
  }
  return {
    actorType: 'anonymous',
    actorUserUuid: null,
    organisationUuid: request.organisationUuid ?? null,
    propertyUuid: request.propertyUuid ?? null,
  };
}
