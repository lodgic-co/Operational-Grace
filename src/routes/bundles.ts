import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { z } from 'zod';
import { AssertServiceCapability, FetchOgBundle } from '../domain/procedures.js';
import { InvalidRequest } from '../errors/index.js';

const CAPABILITY_KEY = 'inventory.occupancy.bundle.read';
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const bodySchema = z.object({
  property_uuid: z.string().regex(UUID_REGEX, 'property_uuid must be a valid UUID'),
  from: z.string().regex(ISO_DATE_REGEX, 'from must be an ISO date (YYYY-MM-DD)'),
  to: z.string().regex(ISO_DATE_REGEX, 'to must be an ISO date (YYYY-MM-DD)'),
  environment: z.enum(['live', 'training']),
  expanded_aot_uuids: z.array(z.string().regex(UUID_REGEX)).min(0),
  composite_and_dual_mode_aot_uuids: z.array(z.string().regex(UUID_REGEX)).default([]),
  dual_mode_aot_uuids: z.array(z.string().regex(UUID_REGEX)).default([]),
  has_exclusive_use_aots: z.boolean(),
});

export interface BundleRoutesOptions {
  livePool: Pool;
  trainingPool: Pool;
  capabilityAllowlistMap: ReadonlyMap<string, ReadonlySet<string>>;
}

export async function bundleRoutes(
  app: FastifyInstance,
  opts: BundleRoutesOptions,
): Promise<void> {
  const { livePool, trainingPool, capabilityAllowlistMap } = opts;

  app.post('/bundles/occupancy', async (request, reply) => {
    AssertServiceCapability(CAPABILITY_KEY, request.callerServiceId, capabilityAllowlistMap);

    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) {
      throw InvalidRequest(parsed.error.issues[0].message);
    }

    const {
      property_uuid,
      from,
      to,
      environment,
      expanded_aot_uuids,
      composite_and_dual_mode_aot_uuids,
      dual_mode_aot_uuids,
      has_exclusive_use_aots,
    } = parsed.data;

    request.auditPropertyUuid = property_uuid;
    request.environment = environment;

    const pool = environment === 'live' ? livePool : trainingPool;

    request.log.debug(
      {
        property_uuid: property_uuid,
        from,
        to,
        environment,
        aot_uuid_count: expanded_aot_uuids.length,
        aot_uuids_sample: expanded_aot_uuids.slice(0, 10),
        aot_uuids_truncated: expanded_aot_uuids.length > 10,
        composite_and_dual_mode_aot_uuid_count: composite_and_dual_mode_aot_uuids.length,
        dual_mode_aot_uuid_count: dual_mode_aot_uuids.length,
        has_exclusive_use_aots: has_exclusive_use_aots,
      },
      'og_occupancy_bundle_request',
    );

    const bundle = await FetchOgBundle(pool, {
      propertyUuid: property_uuid,
      from,
      to,
      expandedAotUuids: expanded_aot_uuids,
      compositeAndDualModeAotUuids: composite_and_dual_mode_aot_uuids,
      dualModeAotUuids: dual_mode_aot_uuids,
      hasExclusiveUseAots: has_exclusive_use_aots,
      log: request.log,
    });

    return reply.code(200).send(bundle);
  });
}
