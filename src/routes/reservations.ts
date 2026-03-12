import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { z } from 'zod';
import { parseDelegatedActor } from '../auth/actor.js';
import { InvalidRequest } from '../errors/index.js';
import {
  ResolveEnvironmentSchema,
  AssertPropertyPermission,
  SelectPropertyReservations,
  BuildPropertyReservationsResponse,
} from '../domain/procedures.js';
import type { MeasuredJudgementClient } from '../http/measured-judgement-client.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const paramsSchema = z.object({
  property_uuid: z.string().regex(UUID_REGEX, 'property_uuid must be a valid UUID'),
});

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50).optional(),
  cursor: z.string().optional(),
});

export interface ReservationRoutesOptions {
  environment: 'live' | 'training';
  livePool: Pool;
  trainingPool: Pool;
  mjClient: MeasuredJudgementClient;
}

export async function reservationRoutes(
  app: FastifyInstance,
  opts: ReservationRoutesOptions,
): Promise<void> {
  const { environment, livePool, trainingPool, mjClient } = opts;

  app.get<{
    Params: { property_uuid: string };
    Querystring: { limit?: string; cursor?: string };
  }>('/properties/:property_uuid/reservations', async (request, reply) => {
    const paramsResult = paramsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      throw InvalidRequest(paramsResult.error.issues[0].message);
    }

    const queryResult = querySchema.safeParse(request.query);
    if (!queryResult.success) {
      throw InvalidRequest(queryResult.error.issues[0].message);
    }

    const actor = parseDelegatedActor(request);
    if (!actor) {
      throw InvalidRequest('Delegated actor headers required');
    }

    const { property_uuid } = paramsResult.data;

    if (!actor.propertyUuid) {
      throw InvalidRequest('X-Property-Uuid is required for property-scoped requests');
    }
    if (actor.propertyUuid !== property_uuid) {
      throw InvalidRequest('X-Property-Uuid must match property_uuid path parameter');
    }

    const limit = queryResult.data.limit ?? 50;
    const cursor = queryResult.data.cursor || undefined;

    request.actorUserUuid = actor.actorUserUuid;
    request.organisationUuid = actor.organisationUuid;
    request.propertyUuid = property_uuid;
    request.environment = environment;

    const { pool } = ResolveEnvironmentSchema(environment, livePool, trainingPool);

    await AssertPropertyPermission(
      mjClient,
      actor.actorUserUuid,
      actor.organisationUuid,
      property_uuid,
      'reservations.view',
      request.requestId,
    );

    const { reservations, next_cursor } = await SelectPropertyReservations(
      pool,
      property_uuid,
      limit,
      cursor,
    );

    const response = BuildPropertyReservationsResponse(reservations, next_cursor);

    return reply.code(200).send(response);
  });
}
