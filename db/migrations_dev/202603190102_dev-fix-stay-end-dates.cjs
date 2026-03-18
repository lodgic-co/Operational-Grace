// Corrective migration: fix reservation_stays end_dates seeded by
// 202603190101_dev-seed-sc-test-commitments.cjs.
//
// That seed was written with checkout-convention end_dates (exclusive), but
// the correct semantics for start_date/end_date are inclusive stay nights.
// Each end_date was one day too high. This migration subtracts one day from
// the end_date of each affected stay row (identified by reservation UUID),
// and relaxes the DB CHECK constraint to allow start_date = end_date (a
// single-night stay).
//
// Also updates the training schema because the seed ran against both schemas.

const R1 = 'ee000001-0000-4000-a000-000000000000';
const R2 = 'ee000002-0000-4000-a000-000000000000';
const R3 = 'ee000003-0000-4000-a000-000000000000';
const R4 = 'ee000004-0000-4000-a000-000000000000';
const R5 = 'ee000005-0000-4000-a000-000000000000';
const R6 = 'ee000006-0000-4000-a000-000000000000';
const R7 = 'ee000007-0000-4000-a000-000000000000';

module.exports.up = (pgm) => {
  // Relax the CHECK constraint to allow start_date = end_date (1-night stay).
  // Safe to run even if the production schema migration has already applied it.
  pgm.sql(`ALTER TABLE reservation_stays DROP CONSTRAINT IF EXISTS reservation_stays_end_date_after_start_date`);
  pgm.sql(`ALTER TABLE reservation_stays DROP CONSTRAINT IF EXISTS reservation_stays_end_date_gte_start_date`);
  pgm.sql(`ALTER TABLE reservation_stays ADD CONSTRAINT reservation_stays_end_date_gte_start_date CHECK (end_date >= start_date)`);

  // Fix end_dates: subtract one day to convert from exclusive checkout date
  // to inclusive last stay night.
  pgm.sql(`
    UPDATE reservation_stays
    SET    end_date = end_date - interval '1 day'
    WHERE  reservation_id IN (
      SELECT id FROM reservations
      WHERE  uuid IN (
        '${R1}', '${R2}', '${R3}', '${R4}',
        '${R5}', '${R6}', '${R7}'
      )
    )
  `);
};

module.exports.down = (pgm) => {
  // Restore original (incorrect) end_dates and strict constraint.
  pgm.sql(`
    UPDATE reservation_stays
    SET    end_date = end_date + interval '1 day'
    WHERE  reservation_id IN (
      SELECT id FROM reservations
      WHERE  uuid IN (
        '${R1}', '${R2}', '${R3}', '${R4}',
        '${R5}', '${R6}', '${R7}'
      )
    )
  `);
  pgm.sql(`ALTER TABLE reservation_stays DROP CONSTRAINT IF EXISTS reservation_stays_end_date_gte_start_date`);
  pgm.sql(`ALTER TABLE reservation_stays ADD CONSTRAINT reservation_stays_end_date_after_start_date CHECK (end_date > start_date)`);
};
