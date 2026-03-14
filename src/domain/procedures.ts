import type { Pool } from 'pg';
import type { Span } from '@opentelemetry/api';
import { encodeCursor, decodeCursor } from './cursor.js';
import { AppError, NotFound, BadGateway } from '../errors/index.js';
import type { MeasuredJudgementClient } from '../http/measured-judgement-client.js';

/**
 * Selects the database pool for the requested operating environment.
 * Called by each route handler with a hardcoded environment literal —
 * not parsed from a URL segment at runtime. The two explicit routes
 * (/live/... and /training/...) make the environment structural.
 *
 * The exhaustiveness guard (never branch) ensures that if the
 * 'live' | 'training' union is ever extended, the compiler will flag
 * this function as needing an update before the code compiles.
 * See: I15-impl-environment-literal-must-not-be-derived-from-request.yaml
 */
export function ResolveEnvironmentSchema(
  environment: 'live' | 'training',
  livePool: Pool,
  trainingPool: Pool,
): { pool: Pool; environment: 'live' | 'training' } {
  if (environment === 'live') {
    return { pool: livePool, environment };
  }
  if (environment === 'training') {
    return { pool: trainingPool, environment };
  }
  // TypeScript makes this branch unreachable. If the union is extended in the
  // future without updating this function, the compiler will error here.
  const _exhaustive: never = environment;
  throw new Error(`ResolveEnvironmentSchema: unhandled environment '${String(_exhaustive)}'`);
}

/**
 * Enforces access to a property for the given actor and permission key.
 * Implements the domain-permission-enforcement pattern:
 * patterns/platform/domain-permission-enforcement.yaml
 *
 * All access-denial conditions (property not found, property outside
 * organisation scope, actor not a member, permission denied) are
 * externally indistinguishable — all map to 404 not_found.
 *
 * The permission check uses MJ's property_uuids scoping so that
 * organisation-level and property-level role assignments are both
 * evaluated in a single call.
 */
export async function AssertPropertyPermission(
  mjClient: MeasuredJudgementClient,
  actorUserUuid: string,
  organisationUuid: string,
  propertyUuid: string,
  permissionKey: string,
  requestId?: string,
  inboundSpan?: Span | null,
): Promise<void> {
  let result: { allowed: boolean };
  try {
    result = await mjClient.checkPermission(
      actorUserUuid,
      organisationUuid,
      permissionKey,
      [propertyUuid],
      requestId,
      inboundSpan,
    );
  } catch (err) {
    if (err instanceof AppError) {
      throw err;
    }
    throw BadGateway('measured-judgement is unavailable');
  }
  if (!result.allowed) {
    throw NotFound();
  }
}

interface ReservationRow {
  id: number;
  reservation_uuid: string;
  created_at_iso: string;
}

/**
 * Retrieves paginated reservation rows for a property from the schema-specific pool.
 * Applies the limit+1 fetch rule. id is an internal field only — it must be
 * stripped by BuildPropertyReservationsResponse before public exposure.
 *
 * created_at is extracted as a full-precision ISO-8601 string (microseconds)
 * via to_char() rather than as a JavaScript Date, which would truncate to
 * milliseconds and cause cursor comparison drift when multiple rows share
 * the same TIMESTAMPTZ value.
 */
export async function SelectPropertyReservations(
  pool: Pool,
  propertyUuid: string,
  limit: number,
  cursor?: string,
): Promise<{ reservations: ReservationRow[]; next_cursor: string | null }> {
  let lastCreatedAt: string | undefined;
  let lastUuid: string | undefined;

  if (cursor) {
    const decoded = decodeCursor(cursor);
    lastCreatedAt = decoded.lastCreatedAt;
    lastUuid = decoded.lastUuid;
  }

  const queryLimit = limit + 1;
  const createdAtExpr = `to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
  let query: string;
  let params: unknown[];

  if (lastCreatedAt !== undefined && lastUuid !== undefined) {
    query = `SELECT id, uuid AS reservation_uuid, ${createdAtExpr} AS created_at_iso
             FROM reservations
             WHERE property_uuid = $1::uuid
               AND (created_at, uuid) > ($3::timestamptz, $4::uuid)
             ORDER BY created_at ASC, uuid ASC
             LIMIT $2`;
    params = [propertyUuid, queryLimit, lastCreatedAt, lastUuid];
  } else {
    query = `SELECT id, uuid AS reservation_uuid, ${createdAtExpr} AS created_at_iso
             FROM reservations
             WHERE property_uuid = $1::uuid
             ORDER BY created_at ASC, uuid ASC
             LIMIT $2`;
    params = [propertyUuid, queryLimit];
  }

  const result = await pool.query(query, params);
  let reservations: ReservationRow[] = result.rows as ReservationRow[];

  let next_cursor: string | null = null;
  if (reservations.length > limit) {
    reservations = reservations.slice(0, limit);
    const lastRow = reservations[reservations.length - 1];
    next_cursor = encodeCursor(lastRow.created_at_iso, lastRow.reservation_uuid);
  }

  return { reservations, next_cursor };
}

/**
 * Maps internal reservation rows to the public response shape.
 * Strips all internal fields (id, created_at) — the public contract
 * exposes only reservation_uuid and the pagination cursor.
 */
export function BuildPropertyReservationsResponse(
  reservations: ReservationRow[],
  nextCursor: string | null,
): { reservations: Array<{ reservation_uuid: string }>; next_cursor: string | null } {
  return {
    reservations: reservations.map((r) => ({
      reservation_uuid: r.reservation_uuid,
    })),
    next_cursor: nextCursor,
  };
}
