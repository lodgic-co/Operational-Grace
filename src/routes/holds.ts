import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { z } from 'zod';
import { parseDelegatedActor } from '../auth/actor.js';
import { InvalidRequest } from '../errors/index.js';
import {
  AssertPropertyPermission,
  CreateHold,
} from '../domain/procedures.js';
import { PublishHoldCreated } from '../domain/events.js';
import type { MeasuredJudgementClient } from '../http/measured-judgement-client.js';
import { config } from '../config/index.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const paramsSchema = z.object({
  property_uuid: z.string().regex(UUID_REGEX, 'property_uuid must be a valid UUID'),
});

const createHoldBodySchema = z.object({
  hold_uuid: z.string().regex(UUID_REGEX, 'hold_uuid must be a valid UUID'),
  expires_at: z.string().min(1, 'expires_at is required'),
  accommodation_option_type_uuid: z.string().regex(UUID_REGEX, 'accommodation_option_type_uuid must be a valid UUID'),
  accommodation_option_uuid: z.string().regex(UUID_REGEX).nullable().optional(),
  check_in: z.string().regex(ISO_DATE_REGEX, 'check_in must be an ISO date (YYYY-MM-DD)'),
  check_out: z.string().regex(ISO_DATE_REGEX, 'check_out must be an ISO date (YYYY-MM-DD)'),
});

export interface HoldRoutesOptions {
  environment: 'live' | 'training';
  livePool: Pool;
  trainingPool: Pool;
  mjClient: MeasuredJudgementClient;
}

export async function holdRoutes(
  app: FastifyInstance,
  opts: HoldRoutesOptions,
): Promise<void> {
  const { environment, livePool, trainingPool, mjClient } = opts;

  app.post<{
    Params: { property_uuid: string };
  }>('/properties/:property_uuid/holds', async (request, reply) => {
    const paramsResult = paramsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      throw InvalidRequest(paramsResult.error.issues[0].message);
    }

    const bodyResult = createHoldBodySchema.safeParse(request.body);
    if (!bodyResult.success) {
      throw InvalidRequest(bodyResult.error.issues[0].message);
    }

    const actor = parseDelegatedActor(request);
    if (!actor) {
      throw InvalidRequest('Delegated actor headers required');
    }

    const { property_uuid } = paramsResult.data;
    const {
      hold_uuid,
      expires_at,
      accommodation_option_type_uuid,
      accommodation_option_uuid,
      check_in,
      check_out,
    } = bodyResult.data;

    if (!actor.propertyUuid) {
      throw InvalidRequest('X-Property-Uuid is required for property-scoped requests');
    }
    if (actor.propertyUuid !== property_uuid) {
      throw InvalidRequest('X-Property-Uuid must match property_uuid path parameter');
    }

    request.auditActorUserUuid = actor.actorUserUuid;
    request.auditOrganisationUuid = actor.organisationUuid;
    request.auditPropertyUuid = property_uuid;
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

    const { hold, was_existing } = await CreateHold(
      environment,
      livePool,
      trainingPool,
      hold_uuid,
      property_uuid,
      accommodation_option_type_uuid,
      accommodation_option_uuid ?? null,
      check_in,
      check_out,
      expires_at,
      {
        workId: request.requestId,
        actorUserUuid: actor.actorUserUuid,
        organisationUuid: actor.organisationUuid,
        propertyUuid: property_uuid,
      },
    );

    if (!was_existing && config.SPECIAL_CIRCUMSTANCES_BASE_URL && config.AUTH0_M2M_AUDIENCE_SPECIAL_CIRCUMSTANCES) {
      void PublishHoldCreated({
        holdUuid: hold_uuid,
        organisationUuid: actor.organisationUuid,
        propertyUuid: property_uuid,
        mode: environment,
        aotUuid: accommodation_option_type_uuid,
        effectiveFromDate: check_in,
        effectiveToDate: check_out,
        cfg: { scBaseUrl: config.SPECIAL_CIRCUMSTANCES_BASE_URL },
      });
    }

    return reply.code(201).send({ hold });
  });
}
