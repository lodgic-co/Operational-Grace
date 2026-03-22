/**
 * OG bundle mapping tests — shape contract at the SQL-to-interface boundary.
 *
 * These tests call FetchOgBundle against the real test database and assert
 * the exact types and formats of the fields that SC uses for key-matching
 * and occupancy arithmetic. They do NOT test decision-procedure logic.
 *
 * Class of bug caught:
 *   - inventory_night returned as a timestamptz string (e.g. "2027-01-16 00:00:00+00")
 *     instead of plain "YYYY-MM-DD". SC indexes OG occupancy by the same composite key
 *     format as CR inventory. If OG's inventory_night differs, SC's Map lookup silently
 *     misses and direct_consumption is zero even with real reservation stays.
 *   - Count fields (room_stay_count, active_hold_count, etc.) returned as strings
 *     instead of numbers. Same arithmetic coercion risk as in CR.
 *   - Boolean fields (property_has_any_occupancy) returned as a non-boolean.
 *     SC's exclusive_use path branches on this value; a string "true" would
 *     be truthy but a string "false" would also be truthy, breaking the logic.
 *
 * The OG side of the date regression is harder to catch end-to-end because the
 * cross-service smoke test for zero occupancy never exercises the OG inventory_night
 * key path at all (OG returns empty arrays when there are no stays or holds).
 * These unit tests catch the regression directly at the query layer.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import pg from 'pg';
import { FetchOgBundle } from '../../src/domain/procedures.js';

// ── Fixture UUIDs (distinct from integration test UUIDs to avoid conflicts) ──

const PROP_UUID = 'f3000000-0000-4000-a000-000000000001';
const AOT_UUID  = 'f3000000-0000-4000-a000-000000000002';
const AO_UUID   = 'f3000000-0000-4000-a000-000000000003';

// Reservation dates: check_in / check_out (exclusive checkout convention)
const CHECK_IN  = '2027-01-16';
const CHECK_OUT = '2027-01-18';

// Stay dates: inclusive start and end nights (start_date=Jan16, end_date=Jan17 = 2 nights)
const STAY_START = '2027-01-16';
const STAY_END   = '2027-01-17';

// Query range that covers both stay nights
const FROM_DATE = '2027-01-16';
const TO_DATE   = '2027-01-17';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const LIVE_SCHEMA = 'operational_grace';

let pool: pg.Pool;

beforeAll(async () => {
  // Prefer DATABASE_URL (same as run-local-ci.sh / .env.test.local). Fall back to
  // DATABASE_URL_DIRECT when DATABASE_URL targets a pooler that rejects startup
  // parameters such as search_path in connection options.
  const dbUrl = process.env['DATABASE_URL'] ?? process.env['DATABASE_URL_DIRECT'];
  if (!dbUrl) throw new Error('DATABASE_URL is required');

  // All OG queries use unqualified table names (e.g. reservation_stays).
  // search_path must be set on every connection via the pg connection options,
  // not via a one-off SET query, because pool.query() may use any pooled connection.
  pool = new pg.Pool({ connectionString: dbUrl, options: `-c search_path=${LIVE_SCHEMA}` });

  // Insert a reservation spanning two nights.
  // Uses check_in / check_out (exclusive checkout) — reservation level.
  await pool.query(`
    INSERT INTO reservations (uuid, property_uuid, guest_name, check_in, check_out)
    VALUES ('f3000000-0000-4000-a000-000000000010'::uuid, $1::uuid, 'Bundle Mapping Test Guest', $2::date, $3::date)
    ON CONFLICT (uuid) DO NOTHING
  `, [PROP_UUID, CHECK_IN, CHECK_OUT]);

  // Insert a reservation_stay using inclusive start_date / end_date night convention.
  // STAY_START=Jan16, STAY_END=Jan17 means: occupied on nights Jan 16 and Jan 17.
  await pool.query(`
    INSERT INTO reservation_stays
      (uuid, reservation_id, accommodation_option_type_uuid, accommodation_option_uuid,
       start_date, end_date, adult_count)
    VALUES (
      'f3000000-0000-4000-a000-000000000011'::uuid,
      (SELECT id FROM reservations WHERE uuid = 'f3000000-0000-4000-a000-000000000010'::uuid),
      $1::uuid,
      $2::uuid,
      $3::date,
      $4::date,
      2
    )
    ON CONFLICT (uuid) DO NOTHING
  `, [AOT_UUID, AO_UUID, STAY_START, STAY_END]);
});

afterAll(async () => {
  // Clean up fixture data so reruns are idempotent.
  await pool.query(`DELETE FROM reservation_stays WHERE uuid = 'f3000000-0000-4000-a000-000000000011'::uuid`);
  await pool.query(`DELETE FROM reservations WHERE uuid = 'f3000000-0000-4000-a000-000000000010'::uuid`);
  await pool.end();
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function baseInput() {
  return {
    propertyUuid: PROP_UUID,
    from: FROM_DATE,
    to: TO_DATE,
    expandedAotUuids: [AOT_UUID],
    compositeAndDualModeAotUuids: [] as string[],
    dualModeAotUuids: [] as string[],
    hasExclusiveUseAots: false,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('FetchOgBundle — inventory_night format', () => {
  it('occupancy_by_aot_and_date inventory_night fields are plain YYYY-MM-DD strings', async () => {
    // Bug class: if the stays query's generate_series emits timestamptz strings,
    // the key "f3000000...:2027-01-16 00:00:00+00" never matches SC's lookup
    // key "f3000000...:2027-01-16", so direct_consumption is silently 0.
    const bundle = await FetchOgBundle(pool, baseInput());

    expect(bundle.occupancy_by_aot_and_date.length).toBeGreaterThan(0);

    for (const entry of bundle.occupancy_by_aot_and_date) {
      expect(entry.inventory_night).toMatch(ISO_DATE_RE);
      expect(entry.inventory_night).not.toContain(' ');
      expect(entry.inventory_night).not.toContain('+');
      expect(entry.inventory_night).not.toContain('T');
    }
  });
});

describe('FetchOgBundle — count field types', () => {
  it('room_stay_count is a JavaScript number, not a string', async () => {
    // Bug class: COUNT()::text returns a pg text value. Without parseInt(),
    // the value "2" would arrive at SC as a string. Subtraction coerces
    // ("2" - 0 = 2) but addition concatenates ("2" + 0 = "20").
    const bundle = await FetchOgBundle(pool, baseInput());

    for (const entry of bundle.occupancy_by_aot_and_date) {
      expect(typeof entry.room_stay_count).toBe('number');
      expect(typeof entry.active_hold_count).toBe('number');
      expect(typeof entry.room_stay_adults).toBe('number');
      expect(typeof entry.active_hold_adults).toBe('number');
    }
  });

  it('room_stay_count reflects the actual number of stay records covering each night', async () => {
    // Positive correctness check: one stay spans both nights; each night
    // should have room_stay_count = 1.
    const bundle = await FetchOgBundle(pool, baseInput());

    const night1 = bundle.occupancy_by_aot_and_date.find(
      (e) => e.accommodation_option_type_uuid === AOT_UUID && e.inventory_night === FROM_DATE,
    );
    expect(night1).toBeDefined();
    expect(night1!.room_stay_count).toBe(1);
    expect(night1!.room_stay_adults).toBe(2);
  });
});

describe('FetchOgBundle — boolean field types', () => {
  it('property_has_any_occupancy is a native boolean, not a string', async () => {
    // Bug class: if the EXISTS(...) expression were cast to ::text, it would
    // return "true" / "false" as strings. A string "false" is truthy in
    // JavaScript, which would make SC believe every night has occupancy,
    // blocking all exclusive_use availability silently.
    const bundle = await FetchOgBundle(pool, { ...baseInput(), hasExclusiveUseAots: true });

    expect(bundle.property_has_any_occupancy_by_date.length).toBeGreaterThan(0);

    for (const entry of bundle.property_has_any_occupancy_by_date) {
      expect(typeof entry.property_has_any_occupancy).toBe('boolean');
      // Inventory exists for these nights so the value should be true
      expect(entry.property_has_any_occupancy).toBe(true);
    }
  });

  it('property_has_any_occupancy inventory_night is a plain YYYY-MM-DD string', async () => {
    // The property_has_any_occupancy query uses generate_series; same date-format risk.
    const bundle = await FetchOgBundle(pool, { ...baseInput(), hasExclusiveUseAots: true });

    for (const entry of bundle.property_has_any_occupancy_by_date) {
      expect(entry.inventory_night).toMatch(ISO_DATE_RE);
      expect(entry.inventory_night).not.toContain(' ');
      expect(entry.inventory_night).not.toContain('+');
    }
  });
});
