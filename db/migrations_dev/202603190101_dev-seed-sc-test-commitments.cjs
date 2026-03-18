// SC business logic test commitments for PROP1.
//
// Clears all existing reservations and holds for PROP1, then inserts a set of
// reservations (with stays) and holds that exercise distinct availability paths
// in SC compute against the inventory seeded by CR 202603190101.
//
// AOT and AO UUIDs are cross-service references to considered-response.
// No FK constraints exist across service boundaries (I16 external_reference_rule).
//
// Scenarios covered (all dates 2026; property 44444444-…):
//
//  STD = Ocean View Double (per_unit, 2 AOs, +1 overbooking 06-01→07-31)
//
//  R1 + R2: both STD AOs committed 2026-06-10→06-11 (two nights each overlapping)
//           → available = max(0, 2+1−2) = 1 on those nights (overbooking fires)
//
//  R1 alone: STD_A still committed on 2026-06-12
//           → available = max(0, 2+1−1) = 2 on that night
//
//  H1: unallocated hold on STD, 2026-06-25→06-26
//           → available = max(0, 2+1−1) = 2 (one unallocated hold deducted)
//
//  R3 + R4: Dorm Bed (per_bed, 6-bed capacity) partially filled on different nights
//           2026-06-20: R3 4 adults → 2 beds remaining
//           2026-06-21: R4 2 adults → 4 beds remaining
//           2026-06-22: R4 2 adults → 4 beds remaining
//
//  R5: Full Cottage Suite (composite) 2026-07-01→07-03
//           → SUITE available = 0; constituent AOs also committed on those nights
//
//  R6: Family Room per_unit 2026-07-10→07-11
//  R7: Family Bed  per_bed  2026-07-10 only (adult_count=2)
//           → dual-mode peer presence exercised on 2026-07-10
//
//  H2: allocated hold on Full Cottage Suite, 2026-08-01→08-04
//           → SUITE available = 0 on those nights via hold path
//
// Training-only extra (operational_grace_training schema only):
//  H3: Dorm Bed hold (adult_count=2), 2026-06-20→06-22
//           → training Dorm availability for 2026-06-20/21 differs from live:
//             2026-06-20: R3(4) + H3(2) = 6 → 0 beds remaining  (vs. live: 2)
//             2026-06-21: R4(2) + H3(2) = 4 → 2 beds remaining  (vs. live: 4)
//
// This migration runs against both operational_grace and operational_grace_training
// schemas (schema-aware pool, search_path set per connection). The WHERE
// current_schema() guard on H3 restricts it to the training schema only.

// ----- Cross-service UUID references (from CR 202603190101) -----

const SC_AOT_STD   = 'cc000101-0000-4000-a000-000000000000'; // Ocean View Double  per_unit
const SC_AOT_DORM  = 'cc000102-0000-4000-a000-000000000000'; // Dorm Bed           per_bed
const SC_AOT_SUITE = 'cc000105-0000-4000-a000-000000000000'; // Full Cottage Suite composite
const SC_AOT_FAM_U = 'cc000106-0000-4000-a000-000000000000'; // Family Room        per_unit
const SC_AOT_FAM_B = 'cc000107-0000-4000-a000-000000000000'; // Family Bed         per_bed

const SC_AO_STD_A  = 'dd000201-0000-4000-a000-000000000000'; // Ocean View Double A
const SC_AO_STD_B  = 'dd000202-0000-4000-a000-000000000000'; // Ocean View Double B
const SC_AO_DORM   = 'dd000301-0000-4000-a000-000000000000'; // Dorm Bed
const SC_AO_SUITE  = 'dd000501-0000-4000-a000-000000000000'; // Full Cottage Suite
const SC_AO_FAM_U  = 'dd000601-0000-4000-a000-000000000000'; // Family Room
const SC_AO_FAM_B  = 'dd000602-0000-4000-a000-000000000000'; // Family Bed

const PROP1_UUID = '44444444-4444-4444-a444-444444444444';

// ----- Reservation UUIDs -----
const R1 = 'ee000001-0000-4000-a000-000000000000';
const R2 = 'ee000002-0000-4000-a000-000000000000';
const R3 = 'ee000003-0000-4000-a000-000000000000';
const R4 = 'ee000004-0000-4000-a000-000000000000';
const R5 = 'ee000005-0000-4000-a000-000000000000';
const R6 = 'ee000006-0000-4000-a000-000000000000';
const R7 = 'ee000007-0000-4000-a000-000000000000';

// ----- Hold UUIDs -----
const H1 = 'ff000001-0000-4000-a000-000000000000'; // STD unallocated, both schemas
const H2 = 'ff000002-0000-4000-a000-000000000000'; // SUITE allocated,  both schemas
const H3 = 'ff000003-0000-4000-a000-000000000000'; // DORM hold,        training only

const FAR_FUTURE = '2027-12-31T23:59:59Z';

module.exports.up = (pgm) => {
  // Clear all existing reservations and holds for PROP1.
  // reservation_stays are deleted via CASCADE on reservations.
  pgm.sql(`DELETE FROM holds        WHERE property_uuid = '${PROP1_UUID}'`);
  pgm.sql(`DELETE FROM reservations WHERE property_uuid = '${PROP1_UUID}'`);

  // -------------------------------------------------------------------------
  // Reservations
  // -------------------------------------------------------------------------
  pgm.sql(`
    INSERT INTO reservations (uuid, property_uuid, guest_name, check_in, check_out)
    VALUES
      ('${R1}', '${PROP1_UUID}', 'Dev Guest One',   '2026-06-10', '2026-06-13'),
      ('${R2}', '${PROP1_UUID}', 'Dev Guest Two',   '2026-06-10', '2026-06-12'),
      ('${R3}', '${PROP1_UUID}', 'Dev Guest Three', '2026-06-20', '2026-06-21'),
      ('${R4}', '${PROP1_UUID}', 'Dev Guest Four',  '2026-06-21', '2026-06-23'),
      ('${R5}', '${PROP1_UUID}', 'Dev Guest Five',  '2026-07-01', '2026-07-04'),
      ('${R6}', '${PROP1_UUID}', 'Dev Guest Six',   '2026-07-10', '2026-07-12'),
      ('${R7}', '${PROP1_UUID}', 'Dev Guest Seven', '2026-07-10', '2026-07-11')
    ON CONFLICT (uuid) DO NOTHING
  `);

  // -------------------------------------------------------------------------
  // Reservation stays
  // start_date/end_date are stay nights — both dates inclusive.
  // end_date is the last night of the stay; must be before reservation check_out.
  // AOT and AO UUIDs are cross-service references; no DB FK (I16).
  // -------------------------------------------------------------------------
  pgm.sql(`
    INSERT INTO reservation_stays
      (reservation_id, accommodation_option_type_uuid, accommodation_option_uuid,
       start_date, end_date, adult_count)
    VALUES
      -- R1: Ocean View Double A, last night 06-12 (stays: 06-10, 06-11, 06-12)
      ((SELECT id FROM reservations WHERE uuid = '${R1}'),
       '${SC_AOT_STD}', '${SC_AO_STD_A}', '2026-06-10', '2026-06-12', 2),

      -- R2: Ocean View Double B, last night 06-11 (stays: 06-10, 06-11) — overlaps R1 on both
      ((SELECT id FROM reservations WHERE uuid = '${R2}'),
       '${SC_AOT_STD}', '${SC_AO_STD_B}', '2026-06-10', '2026-06-11', 2),

      -- R3: Dorm Bed, 1 night (06-20), 4 adults
      ((SELECT id FROM reservations WHERE uuid = '${R3}'),
       '${SC_AOT_DORM}', '${SC_AO_DORM}', '2026-06-20', '2026-06-20', 4),

      -- R4: Dorm Bed, last night 06-22 (stays: 06-21, 06-22), 2 adults — no overlap with R3
      ((SELECT id FROM reservations WHERE uuid = '${R4}'),
       '${SC_AOT_DORM}', '${SC_AO_DORM}', '2026-06-21', '2026-06-22', 2),

      -- R5: Full Cottage Suite (composite AO), last night 07-03 (stays: 07-01, 07-02, 07-03)
      ((SELECT id FROM reservations WHERE uuid = '${R5}'),
       '${SC_AOT_SUITE}', '${SC_AO_SUITE}', '2026-07-01', '2026-07-03', 2),

      -- R6: Family Room (per_unit dual peer), last night 07-11 (stays: 07-10, 07-11)
      ((SELECT id FROM reservations WHERE uuid = '${R6}'),
       '${SC_AOT_FAM_U}', '${SC_AO_FAM_U}', '2026-07-10', '2026-07-11', 2),

      -- R7: Family Bed (per_bed dual peer), 1 night (07-10), 2 adults
      ((SELECT id FROM reservations WHERE uuid = '${R7}'),
       '${SC_AOT_FAM_B}', '${SC_AO_FAM_B}', '2026-07-10', '2026-07-10', 2)
    ON CONFLICT DO NOTHING
  `);

  // -------------------------------------------------------------------------
  // Holds — both schemas
  // H1: unallocated STD hold (no AO), exercises unallocated deduction path.
  // H2: allocated SUITE hold, exercises hold path for composite.
  // expires_at is far-future so holds are always active during test window.
  // -------------------------------------------------------------------------
  pgm.sql(`
    INSERT INTO holds
      (uuid, property_uuid, accommodation_option_type_uuid, accommodation_option_uuid,
       check_in, check_out, expires_at, adult_count)
    VALUES
      ('${H1}', '${PROP1_UUID}', '${SC_AOT_STD}',   NULL,            '2026-06-25', '2026-06-27', '${FAR_FUTURE}'::timestamptz, NULL),
      ('${H2}', '${PROP1_UUID}', '${SC_AOT_SUITE}', '${SC_AO_SUITE}','2026-08-01', '2026-08-05', '${FAR_FUTURE}'::timestamptz, 2)
    ON CONFLICT (uuid) DO NOTHING
  `);

  // -------------------------------------------------------------------------
  // Training-only hold — inserted only when running against
  // operational_grace_training (the SC /training environment).
  //
  // H3: Dorm Bed hold, 2026-06-20→06-22, adult_count=2.
  // Combined with R3 (4 adults, 06-20) and R4 (2 adults, 06-21→06-22),
  // the training schema has higher dorm occupancy than live:
  //   live      2026-06-20: 4 committed  → 2 remaining
  //   training  2026-06-20: 4+2 = 6     → 0 remaining  (capacity reached)
  // -------------------------------------------------------------------------
  pgm.sql(`
    INSERT INTO holds
      (uuid, property_uuid, accommodation_option_type_uuid, accommodation_option_uuid,
       check_in, check_out, expires_at, adult_count)
    SELECT
      '${H3}',
      '${PROP1_UUID}',
      '${SC_AOT_DORM}',
      '${SC_AO_DORM}',
      '2026-06-20',
      '2026-06-22',
      '${FAR_FUTURE}'::timestamptz,
      2
    WHERE current_schema() = 'operational_grace_training'
    ON CONFLICT (uuid) DO NOTHING
  `);
};

module.exports.down = (pgm) => {
  // Delete by UUID. In live schema, H3 does not exist; DELETE affects 0 rows.
  pgm.sql(`
    DELETE FROM holds
    WHERE uuid IN ('${H1}', '${H2}', '${H3}')
  `);
  pgm.sql(`
    DELETE FROM reservations
    WHERE uuid IN ('${R1}', '${R2}', '${R3}', '${R4}', '${R5}', '${R6}', '${R7}')
  `);
};
