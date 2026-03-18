import type { Pool, PoolClient } from 'pg';
import type { Span } from '@opentelemetry/api';
import { encodeCursor, decodeCursor } from './cursor.js';
import { AppError, NotFound, BadGateway, InvalidRequest, Unauthenticated } from '../errors/index.js';
import type { MeasuredJudgementClient } from '../http/measured-judgement-client.js';

// ---------------------------------------------------------------------------
// Service Capability Enforcement
// ---------------------------------------------------------------------------

/**
 * Asserts that the caller identified by callerServiceId is authorised to
 * exercise the given capability key, per the startup-time capability map.
 *
 * Throws 401 Unauthenticated if the caller is not in the allowlist for the
 * capability. No MJ call is made at request time.
 */
export function AssertServiceCapability(
  capabilityKey: string,
  callerServiceId: string,
  capabilityAllowlistMap: ReadonlyMap<string, ReadonlySet<string>>,
): void {
  const allowedCallers = capabilityAllowlistMap.get(capabilityKey);
  if (!allowedCallers || !allowedCallers.has(callerServiceId)) {
    throw Unauthenticated(`Caller is not authorised for capability: ${capabilityKey}`);
  }
}

// ---------------------------------------------------------------------------
// OG Bundle Assembly
// ---------------------------------------------------------------------------

export interface OccupancyByAotAndDate {
  accommodation_option_type_uuid: string;
  inventory_night: string;
  room_stay_count: number;
  active_hold_count: number;
  room_stay_adults: number;
  active_hold_adults: number;
}

export interface OgStateByAo {
  accommodation_option_uuid: string;
  accommodation_option_type_uuid: string;
  inventory_night: string;
  has_room_stay: boolean;
  has_active_hold: boolean;
}

export interface UnallocatedByAotAndDate {
  accommodation_option_type_uuid: string;
  inventory_night: string;
  unallocated_room_stay_count: number;
  unallocated_hold_count: number;
  unallocated_room_stay_adults: number;
  unallocated_hold_adults: number;
}

export interface PropertyHasAnyOccupancyByDate {
  inventory_night: string;
  property_has_any_occupancy: boolean;
}

export interface OgBundle {
  occupancy_by_aot_and_date: OccupancyByAotAndDate[];
  og_state_by_ao: OgStateByAo[];
  unallocated_by_aot_and_date: UnallocatedByAotAndDate[];
  property_has_any_occupancy_by_date: PropertyHasAnyOccupancyByDate[];
}

export interface FetchOgBundleInput {
  propertyUuid: string;
  from: string;
  to: string;
  expandedAotUuids: string[];
  compositeAndDualModeAotUuids: string[];
  dualModeAotUuids: string[];
  hasExclusiveUseAots: boolean;
}

/**
 * Assembles the OG bundle for a rebuild scope. Called by POST /bundles/occupancy
 * via AssertServiceCapability (capability: inventory.occupancy.bundle.read).
 *
 * Queries live or training schema via the environment-appropriate pool.
 * All queries follow the assembly logic from sc-bundle-input-shapes.md.
 */
export async function FetchOgBundle(
  pool: Pool,
  input: FetchOgBundleInput,
): Promise<OgBundle> {
  const {
    propertyUuid,
    from,
    to,
    expandedAotUuids,
    compositeAndDualModeAotUuids,
    dualModeAotUuids,
    hasExclusiveUseAots,
  } = input;

  if (!propertyUuid) throw InvalidRequest('property_uuid is required');
  if (!from) throw InvalidRequest('from is required');
  if (!to) throw InvalidRequest('to is required');

  if (expandedAotUuids.length === 0) {
    return {
      occupancy_by_aot_and_date: [],
      og_state_by_ao: [],
      unallocated_by_aot_and_date: [],
      property_has_any_occupancy_by_date: [],
    };
  }

  // occupancy_by_aot_and_date — merge stays + holds per (AOT, night)
  const staysOccupancy = await pool.query<{
    accommodation_option_type_uuid: string;
    inventory_night: string;
    room_stay_count: string;
    room_stay_adults: string;
  }>(
    `SELECT rs.accommodation_option_type_uuid,
            d.inventory_night::text,
            COUNT(*)::text              AS room_stay_count,
            COALESCE(SUM(rs.adult_count), 0)::text AS room_stay_adults
     FROM   reservation_stays rs
     CROSS JOIN generate_series(rs.start_date, rs.end_date - interval '1 day', '1 day') AS d(inventory_night)
     WHERE  rs.accommodation_option_type_uuid = ANY($1::uuid[])
       AND  d.inventory_night BETWEEN $2::date AND $3::date
     GROUP BY rs.accommodation_option_type_uuid, d.inventory_night`,
    [expandedAotUuids, from, to],
  );

  const holdsOccupancy = await pool.query<{
    accommodation_option_type_uuid: string;
    inventory_night: string;
    active_hold_count: string;
    active_hold_adults: string;
  }>(
    `SELECT h.accommodation_option_type_uuid,
            d.inventory_night::text,
            COUNT(*)::text              AS active_hold_count,
            COALESCE(SUM(h.adult_count), 0)::text AS active_hold_adults
     FROM   holds h
     CROSS JOIN generate_series(h.check_in, h.check_out - interval '1 day', '1 day') AS d(inventory_night)
     WHERE  h.accommodation_option_type_uuid = ANY($1::uuid[])
       AND  d.inventory_night BETWEEN $2::date AND $3::date
       AND  h.expires_at > now()
     GROUP BY h.accommodation_option_type_uuid, d.inventory_night`,
    [expandedAotUuids, from, to],
  );

  // Merge stays + holds per (AOT, night)
  const occupancyMap = new Map<string, OccupancyByAotAndDate>();
  for (const r of staysOccupancy.rows) {
    const key = `${r.accommodation_option_type_uuid}:${r.inventory_night}`;
    occupancyMap.set(key, {
      accommodation_option_type_uuid: r.accommodation_option_type_uuid,
      inventory_night: r.inventory_night,
      room_stay_count: parseInt(r.room_stay_count, 10),
      active_hold_count: 0,
      room_stay_adults: parseInt(r.room_stay_adults, 10),
      active_hold_adults: 0,
    });
  }
  for (const r of holdsOccupancy.rows) {
    const key = `${r.accommodation_option_type_uuid}:${r.inventory_night}`;
    const existing = occupancyMap.get(key);
    if (existing) {
      existing.active_hold_count = parseInt(r.active_hold_count, 10);
      existing.active_hold_adults = parseInt(r.active_hold_adults, 10);
    } else {
      occupancyMap.set(key, {
        accommodation_option_type_uuid: r.accommodation_option_type_uuid,
        inventory_night: r.inventory_night,
        room_stay_count: 0,
        active_hold_count: parseInt(r.active_hold_count, 10),
        room_stay_adults: 0,
        active_hold_adults: parseInt(r.active_hold_adults, 10),
      });
    }
  }
  const occupancyByAotAndDate = Array.from(occupancyMap.values());

  // og_state_by_ao — composite and dual-mode AOs only
  let ogStateByAo: OgStateByAo[] = [];
  if (compositeAndDualModeAotUuids.length > 0) {
    const stateRows = await pool.query<{
      ao_uuid: string;
      aot_uuid: string;
      inventory_night: string;
      has_room_stay: boolean;
      has_active_hold: boolean;
    }>(
      `SELECT
         x.ao_uuid,
         x.aot_uuid,
         x.inventory_night,
         bool_or(x.source = 'stay') AS has_room_stay,
         bool_or(x.source = 'hold') AS has_active_hold
       FROM (
         SELECT rs.accommodation_option_uuid    AS ao_uuid,
                rs.accommodation_option_type_uuid AS aot_uuid,
                d.inventory_night::text,
                'stay' AS source
         FROM   reservation_stays rs
         CROSS JOIN generate_series(rs.start_date, rs.end_date - interval '1 day', '1 day') AS d(inventory_night)
         WHERE  rs.accommodation_option_uuid IS NOT NULL
           AND  rs.accommodation_option_type_uuid = ANY($1::uuid[])
           AND  d.inventory_night BETWEEN $2::date AND $3::date

         UNION ALL

         SELECT h.accommodation_option_uuid,
                h.accommodation_option_type_uuid,
                d.inventory_night::text,
                'hold'
         FROM   holds h
         CROSS JOIN generate_series(h.check_in, h.check_out - interval '1 day', '1 day') AS d(inventory_night)
         WHERE  h.accommodation_option_uuid IS NOT NULL
           AND  h.accommodation_option_type_uuid = ANY($1::uuid[])
           AND  d.inventory_night BETWEEN $2::date AND $3::date
           AND  h.expires_at > now()
       ) x
       GROUP BY x.ao_uuid, x.aot_uuid, x.inventory_night`,
      [compositeAndDualModeAotUuids, from, to],
    );

    ogStateByAo = stateRows.rows.map((r) => ({
      accommodation_option_uuid: r.ao_uuid,
      accommodation_option_type_uuid: r.aot_uuid,
      inventory_night: r.inventory_night,
      has_room_stay: r.has_room_stay,
      has_active_hold: r.has_active_hold,
    }));
  }

  // unallocated_by_aot_and_date — dual-mode peer AOTs only
  let unallocatedByAotAndDate: UnallocatedByAotAndDate[] = [];
  if (dualModeAotUuids.length > 0) {
    const unallocStays = await pool.query<{
      accommodation_option_type_uuid: string;
      inventory_night: string;
      unallocated_count: string;
      unallocated_adults: string;
    }>(
      `SELECT rs.accommodation_option_type_uuid,
              d.inventory_night::text,
              COUNT(*)::text              AS unallocated_count,
              COALESCE(SUM(rs.adult_count), 0)::text AS unallocated_adults
       FROM   reservation_stays rs
       CROSS JOIN generate_series(rs.start_date, rs.end_date - interval '1 day', '1 day') AS d(inventory_night)
       WHERE  rs.accommodation_option_uuid IS NULL
         AND  rs.accommodation_option_type_uuid = ANY($1::uuid[])
         AND  d.inventory_night BETWEEN $2::date AND $3::date
       GROUP BY rs.accommodation_option_type_uuid, d.inventory_night`,
      [dualModeAotUuids, from, to],
    );

    const unallocHolds = await pool.query<{
      accommodation_option_type_uuid: string;
      inventory_night: string;
      unallocated_count: string;
      unallocated_adults: string;
    }>(
      `SELECT h.accommodation_option_type_uuid,
              d.inventory_night::text,
              COUNT(*)::text              AS unallocated_count,
              COALESCE(SUM(h.adult_count), 0)::text AS unallocated_adults
       FROM   holds h
       CROSS JOIN generate_series(h.check_in, h.check_out - interval '1 day', '1 day') AS d(inventory_night)
       WHERE  h.accommodation_option_uuid IS NULL
         AND  h.accommodation_option_type_uuid = ANY($1::uuid[])
         AND  d.inventory_night BETWEEN $2::date AND $3::date
         AND  h.expires_at > now()
       GROUP BY h.accommodation_option_type_uuid, d.inventory_night`,
      [dualModeAotUuids, from, to],
    );

    const unallocMap = new Map<string, UnallocatedByAotAndDate>();
    for (const r of unallocStays.rows) {
      const key = `${r.accommodation_option_type_uuid}:${r.inventory_night}`;
      unallocMap.set(key, {
        accommodation_option_type_uuid: r.accommodation_option_type_uuid,
        inventory_night: r.inventory_night,
        unallocated_room_stay_count: parseInt(r.unallocated_count, 10),
        unallocated_hold_count: 0,
        unallocated_room_stay_adults: parseInt(r.unallocated_adults, 10),
        unallocated_hold_adults: 0,
      });
    }
    for (const r of unallocHolds.rows) {
      const key = `${r.accommodation_option_type_uuid}:${r.inventory_night}`;
      const existing = unallocMap.get(key);
      if (existing) {
        existing.unallocated_hold_count = parseInt(r.unallocated_count, 10);
        existing.unallocated_hold_adults = parseInt(r.unallocated_adults, 10);
      } else {
        unallocMap.set(key, {
          accommodation_option_type_uuid: r.accommodation_option_type_uuid,
          inventory_night: r.inventory_night,
          unallocated_room_stay_count: 0,
          unallocated_hold_count: parseInt(r.unallocated_count, 10),
          unallocated_room_stay_adults: 0,
          unallocated_hold_adults: parseInt(r.unallocated_adults, 10),
        });
      }
    }
    unallocatedByAotAndDate = Array.from(unallocMap.values());
  }

  // property_has_any_occupancy_by_date — exclusive_use AOTs only
  let propertyHasAnyOccupancyByDate: PropertyHasAnyOccupancyByDate[] = [];
  if (hasExclusiveUseAots) {
    const phaoResult = await pool.query<{
      inventory_night: string;
      property_has_any_occupancy: boolean;
    }>(
      `SELECT d.inventory_night::text,
              EXISTS (
                SELECT 1
                FROM   reservation_stays rs
                JOIN   reservations r ON r.id = rs.reservation_id
                CROSS JOIN generate_series(rs.start_date, rs.end_date - interval '1 day', '1 day') AS n(night)
                WHERE  r.property_uuid = $1::uuid
                  AND  n.night = d.inventory_night

                UNION ALL

                SELECT 1
                FROM   holds h
                CROSS JOIN generate_series(h.check_in, h.check_out - interval '1 day', '1 day') AS n(night)
                WHERE  h.property_uuid = $1::uuid
                  AND  n.night = d.inventory_night
                  AND  h.expires_at > now()
              ) AS property_has_any_occupancy
       FROM   generate_series($2::date, $3::date, '1 day') AS d(inventory_night)`,
      [propertyUuid, from, to],
    );

    propertyHasAnyOccupancyByDate = phaoResult.rows.map((r) => ({
      inventory_night: r.inventory_night,
      property_has_any_occupancy: r.property_has_any_occupancy,
    }));
  }

  return {
    occupancy_by_aot_and_date: occupancyByAotAndDate,
    og_state_by_ao: ogStateByAo,
    unallocated_by_aot_and_date: unallocatedByAotAndDate,
    property_has_any_occupancy_by_date: propertyHasAnyOccupancyByDate,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Reservation + Stay create procedures
// I16-impl-mutation-procedure-taxonomy-and-transaction-discipline
// ─────────────────────────────────────────────────────────────────────────────

export interface CreatedReservationRow {
  id: number;
  uuid: string;
  property_uuid: string;
  guest_name: string;
  check_in: string;
  check_out: string;
  created_at: string;
}

export interface StayRow {
  uuid: string;
  reservation_id: number;
  accommodation_option_type_uuid: string;
  accommodation_option_uuid: string | null;
  start_date: string;
  end_date: string;
  adult_count: number | null;
  created_at: string;
}

/**
 * Inserts a reservation row using ON CONFLICT (uuid) DO NOTHING for
 * client-supplied UUID idempotence. Returns the record and was_existing flag.
 * Called within a caller-supplied transaction context — does not own its
 * own transaction.
 *
 * Implements create procedure taxonomy per I16.
 */
export async function CreateReservation(
  trx: PoolClient,
  reservationUuid: string,
  propertyUuid: string,
  guestName: string,
  checkIn: string,
  checkOut: string,
): Promise<{ reservation: CreatedReservationRow; was_existing: boolean }> {
  const insertResult = await trx.query(
    `INSERT INTO reservations (uuid, property_uuid, guest_name, check_in, check_out)
     VALUES ($1::uuid, $2::uuid, $3, $4::date, $5::date)
     ON CONFLICT (uuid) DO NOTHING`,
    [reservationUuid, propertyUuid, guestName, checkIn, checkOut],
  );

  const was_existing = (insertResult.rowCount ?? 0) === 0;

  const result = await trx.query(
    `SELECT id, uuid, property_uuid, guest_name,
            check_in::text, check_out::text,
            to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at
     FROM reservations
     WHERE uuid = $1::uuid`,
    [reservationUuid],
  );

  return { reservation: result.rows[0] as CreatedReservationRow, was_existing };
}

/**
 * Inserts one reservation_stay row within a caller-supplied transaction.
 * stay UUID is generated server-side via gen_random_uuid() at insert time.
 * Does not own its own transaction — called by CreateReservationWithStays.
 *
 * Implements create procedure taxonomy per I16.
 */
export async function CreateReservationStay(
  trx: PoolClient,
  reservationId: number,
  accommodationOptionTypeUuid: string,
  accommodationOptionUuid: string | null,
  startDate: string,
  endDate: string,
  adultCount: number | null,
): Promise<StayRow> {
  const result = await trx.query(
    `INSERT INTO reservation_stays
       (reservation_id, accommodation_option_type_uuid, accommodation_option_uuid,
        start_date, end_date, adult_count)
     VALUES ($1, $2::uuid, $3, $4::date, $5::date, $6)
     RETURNING
       uuid,
       reservation_id,
       accommodation_option_type_uuid,
       accommodation_option_uuid,
       start_date::text,
       end_date::text,
       adult_count,
       to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at`,
    [reservationId, accommodationOptionTypeUuid, accommodationOptionUuid ?? null,
     startDate, endDate, adultCount ?? null],
  );
  return result.rows[0] as StayRow;
}

export interface StayInput {
  accommodation_option_type_uuid: string;
  accommodation_option_uuid?: string | null;
  start_date: string;
  end_date: string;
  adult_count?: number | null;
}

export interface CreateReservationResult {
  was_existing: boolean;
  reservation: {
    uuid: string;
    property_uuid: string;
    guest_name: string;
    check_in: string;
    check_out: string;
    created_at: string;
  };
  stays: StayRow[];
}

/**
 * Orchestrating create procedure. Owns the full transaction boundary for
 * reservation + all stays. Calls CreateReservation and CreateReservationStay
 * as sub-procedures within the transaction.
 *
 * Idempotence: if was_existing=true (reservation UUID already existed), the
 * existing reservation and its stays are returned without inserting new rows.
 *
 * BEGIN → CreateReservation → N × CreateReservationStay → COMMIT
 * Any failure → ROLLBACK. Partial writes are not possible.
 *
 * Implements create procedure taxonomy per I16.
 */
export async function CreateReservationWithStays(
  environment: 'live' | 'training',
  livePool: Pool,
  trainingPool: Pool,
  reservationUuid: string,
  propertyUuid: string,
  guestName: string,
  checkIn: string,
  checkOut: string,
  stays: StayInput[],
): Promise<CreateReservationResult> {
  if (stays.length === 0) {
    throw InvalidRequest('A reservation must contain at least one stay');
  }

  if (checkOut <= checkIn) {
    throw InvalidRequest('reservation check_out must be greater than check_in');
  }

  for (const stay of stays) {
    if (stay.end_date <= stay.start_date) {
      throw InvalidRequest('stay end_date must be greater than start_date');
    }
    if (stay.start_date < checkIn) {
      throw InvalidRequest('stay start_date must not be before reservation check_in');
    }
    if (stay.end_date > checkOut) {
      throw InvalidRequest('stay end_date must not be after reservation check_out');
    }
  }

  const { pool: envPool } = ResolveEnvironmentSchema(environment, livePool, trainingPool);
  const trx = await envPool.connect();

  try {
    await trx.query('BEGIN');

    const { reservation, was_existing } = await CreateReservation(
      trx,
      reservationUuid,
      propertyUuid,
      guestName,
      checkIn,
      checkOut,
    );

    let stayRows: StayRow[];

    if (was_existing) {
      const existing = await trx.query(
        `SELECT uuid, reservation_id, accommodation_option_type_uuid, accommodation_option_uuid,
                start_date::text, end_date::text, adult_count,
                to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at
         FROM reservation_stays
         WHERE reservation_id = $1`,
        [reservation.id],
      );
      stayRows = existing.rows as StayRow[];
    } else {
      stayRows = [];
      for (const stay of stays) {
        const stayRow = await CreateReservationStay(
          trx,
          reservation.id,
          stay.accommodation_option_type_uuid,
          stay.accommodation_option_uuid ?? null,
          stay.start_date,
          stay.end_date,
          stay.adult_count ?? null,
        );
        stayRows.push(stayRow);
      }
    }

    await trx.query('COMMIT');

    return {
      was_existing,
      reservation: {
        uuid: reservation.uuid,
        property_uuid: reservation.property_uuid,
        guest_name: reservation.guest_name,
        check_in: reservation.check_in,
        check_out: reservation.check_out,
        created_at: reservation.created_at,
      },
      stays: stayRows,
    };
  } catch (err) {
    await trx.query('ROLLBACK');
    throw err;
  } finally {
    trx.release();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Hold create procedure
// ─────────────────────────────────────────────────────────────────────────────

export interface HoldRow {
  uuid: string;
  property_uuid: string;
  accommodation_option_type_uuid: string;
  accommodation_option_uuid: string | null;
  check_in: string;
  check_out: string;
  expires_at: string;
  created_at: string;
}

export interface CreateHoldResult {
  hold: HoldRow;
  was_existing: boolean;
}

/**
 * Flat create procedure for a hold. Owns its own transaction boundary.
 * Idempotence is enforced via UNIQUE (uuid) ON CONFLICT DO NOTHING.
 * Returns the hold record and a was_existing flag.
 *
 * BEGIN → INSERT holds ON CONFLICT (uuid) DO NOTHING → SELECT → COMMIT
 * Any failure → ROLLBACK. Partial writes are not possible.
 *
 * Implements create procedure taxonomy per I16.
 */
export async function CreateHold(
  environment: 'live' | 'training',
  livePool: Pool,
  trainingPool: Pool,
  holdUuid: string,
  propertyUuid: string,
  accommodationOptionTypeUuid: string,
  accommodationOptionUuid: string | null,
  checkIn: string,
  checkOut: string,
  expiresAt: string,
): Promise<CreateHoldResult> {
  if (checkOut <= checkIn) {
    throw InvalidRequest('check_out must be greater than check_in');
  }

  const { pool: envPool } = ResolveEnvironmentSchema(environment, livePool, trainingPool);
  const trx = await envPool.connect();

  try {
    await trx.query('BEGIN');

    const insertResult = await trx.query(
      `INSERT INTO holds
         (uuid, property_uuid, accommodation_option_type_uuid, accommodation_option_uuid,
          check_in, check_out, expires_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5::date, $6::date, $7::timestamptz)
       ON CONFLICT (uuid) DO NOTHING`,
      [
        holdUuid,
        propertyUuid,
        accommodationOptionTypeUuid,
        accommodationOptionUuid ?? null,
        checkIn,
        checkOut,
        expiresAt,
      ],
    );

    const was_existing = insertResult.rowCount === 0;

    const selectResult = await trx.query(
      `SELECT uuid, property_uuid, accommodation_option_type_uuid, accommodation_option_uuid,
              check_in::text, check_out::text,
              to_char(expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS expires_at,
              to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at
       FROM holds
       WHERE uuid = $1::uuid`,
      [holdUuid],
    );

    await trx.query('COMMIT');

    return { hold: selectResult.rows[0] as HoldRow, was_existing };
  } catch (err) {
    await trx.query('ROLLBACK');
    throw err;
  } finally {
    trx.release();
  }
}

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
