import type { FastifyRequest } from 'fastify';
import { InvalidRequest } from '../errors/index.js';

export interface DelegatedActorContext {
  actorUserUuid: string;
  organisationUuid: string;
  propertyUuid: string | null;
}

const HEADER_ACTOR_TYPE = 'x-actor-type';
const HEADER_ACTOR_USER_UUID = 'x-actor-user-uuid';
const HEADER_ORGANISATION_UUID = 'x-organisation-uuid';
const HEADER_PROPERTY_UUID = 'x-property-uuid';

/**
 * Parses delegated actor context forwarded by polite-intervention.
 * Only `user` actors are accepted — reservation access requires an identified user.
 * Returns null if no actor context is present.
 *
 * propertyUuid is read from X-Property-Uuid when present. Property-scoped
 * route handlers must assert it is non-null and matches the path parameter
 * per the delegated-actor-context contract (contracts/delegated-actor-context.yaml).
 */
export function parseDelegatedActor(request: FastifyRequest): DelegatedActorContext | null {
  const actorType = singleHeader(request, HEADER_ACTOR_TYPE);
  const actorUserUuid = singleHeader(request, HEADER_ACTOR_USER_UUID);
  const organisationUuid = singleHeader(request, HEADER_ORGANISATION_UUID);
  const propertyUuid = singleHeader(request, HEADER_PROPERTY_UUID);

  if (!actorType && !actorUserUuid && !organisationUuid) {
    return null;
  }

  if (actorType !== 'user') {
    throw InvalidRequest('X-Actor-Type must be user for reservation access');
  }

  if (!actorUserUuid) {
    throw InvalidRequest('X-Actor-User-Uuid is required when X-Actor-Type is user');
  }

  if (!organisationUuid) {
    throw InvalidRequest('X-Organisation-Uuid is required');
  }

  return { actorUserUuid, organisationUuid, propertyUuid };
}

function singleHeader(request: FastifyRequest, name: string): string | null {
  const value = request.headers[name];
  if (value === undefined) return null;
  const str = Array.isArray(value) ? value[0] : value;
  if (!str || str.trim().length === 0) return null;
  return str.trim();
}
