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
  CreateReservationWithStays,
  type StayInput,
} from '../domain/procedures.js';
import { PublishReservationCreated } from '../domain/events.js';
import type { MeasuredJudgementClient } from '../http/measured-judgement-client.js';
import { config } from '../config/index.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const paramsSchema = z.object({
  property_uuid: z.string().regex(UUID_REGEX, 'property_uuid must be a valid UUID'),
});

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50).optional(),
  cursor: z.string().optional(),
});

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const staySchema = z.object({
  accommodation_option_type_uuid: z.string().regex(UUID_REGEX),
  accommodation_option_uuid: z.string().regex(UUID_REGEX).nullable().optional(),
  start_date: z.string().regex(ISO_DATE_REGEX, 'start_date must be an ISO date'),
  end_date: z.string().regex(ISO_DATE_REGEX, 'end_date must be an ISO date'),
  adult_count: z.number().int().nullable().optional(),
});

const createReservationBodySchema = z.object({
  reservation_uuid: z.string().regex(UUID_REGEX, 'reservation_uuid must be a valid UUID'),
  guest_name: z.string().min(1, 'guest_name is required'),
  check_in: z.string().regex(ISO_DATE_REGEX, 'check_in must be an ISO date'),
  check_out: z.string().regex(ISO_DATE_REGEX, 'check_out must be an ISO date'),
  stays: z.array(staySchema).min(1, 'At least one stay is required'),
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
      request.inboundSpan,
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

  app.post<{
    Params: { property_uuid: string };
  }>('/properties/:property_uuid/reservations', async (request, reply) => {
    const paramsResult = paramsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      throw InvalidRequest(paramsResult.error.issues[0].message);
    }

    const bodyResult = createReservationBodySchema.safeParse(request.body);
    if (!bodyResult.success) {
      throw InvalidRequest(bodyResult.error.issues[0].message);
    }

    const actor = parseDelegatedActor(request);
    if (!actor) {
      throw InvalidRequest('Delegated actor headers required');
    }

    const { property_uuid } = paramsResult.data;
    const { reservation_uuid, guest_name, check_in, check_out, stays } = bodyResult.data;

    if (!actor.propertyUuid) {
      throw InvalidRequest('X-Property-Uuid is required for property-scoped requests');
    }
    if (actor.propertyUuid !== property_uuid) {
      throw InvalidRequest('X-Property-Uuid must match property_uuid path parameter');
    }

    request.actorUserUuid = actor.actorUserUuid;
    request.organisationUuid = actor.organisationUuid;
    request.propertyUuid = property_uuid;
    request.environment = environment;

    await AssertPropertyPermission(
      mjClient,
      actor.actorUserUuid,
      actor.organisationUuid,
      property_uuid,
      'reservations.create',
      request.requestId,
      request.inboundSpan,
    );

    const stayInputs: StayInput[] = stays.map((s) => ({
      accommodation_option_type_uuid: s.accommodation_option_type_uuid,
      accommodation_option_uuid: s.accommodation_option_uuid ?? null,
      start_date: s.start_date,
      end_date: s.end_date,
      adult_count: s.adult_count ?? null,
    }));

    const result = await CreateReservationWithStays(
      environment,
      livePool,
      trainingPool,
      reservation_uuid,
      property_uuid,
      guest_name,
      check_in,
      check_out,
      stayInputs,
    );

    if (!result.was_existing && config.SC_INGEST_URL && config.AUTH0_M2M_AUDIENCE_SPECIAL_CIRCUMSTANCES) {
      void PublishReservationCreated({
        reservationUuid: reservation_uuid,
        organisationUuid: actor.organisationUuid,
        propertyUuid: property_uuid,
        mode: environment,
        stays: stayInputs.map((s) => ({
          aot_uuid: s.accommodation_option_type_uuid,
          effective_from_date: s.start_date,
          effective_to_date: s.end_date,
        })),
        cfg: { scIngestUrl: config.SC_INGEST_URL },
      });
    }

    return reply.code(201).send(result);
  });
}
