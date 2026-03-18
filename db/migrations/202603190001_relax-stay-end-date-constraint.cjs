/**
 * Relaxes the reservation_stays end_date CHECK constraint from strict
 * greater-than to greater-than-or-equal.
 *
 * Rationale: start_date and end_date represent actual stay nights (inclusive).
 * A single-night stay legitimately has start_date = end_date. The previous
 * strict constraint (end_date > start_date) reflected checkout-date semantics
 * carried over from the original check_in/check_out columns; it was
 * incorrect for inclusive night-allocation semantics.
 *
 * Applies to both operational_grace and operational_grace_training schemas.
 */
module.exports.up = (pgm) => {
  pgm.sql(`ALTER TABLE reservation_stays DROP CONSTRAINT IF EXISTS reservation_stays_end_date_after_start_date`);
  pgm.sql(`ALTER TABLE reservation_stays DROP CONSTRAINT IF EXISTS reservation_stays_end_date_gte_start_date`);
  pgm.sql(`ALTER TABLE reservation_stays ADD CONSTRAINT reservation_stays_end_date_gte_start_date CHECK (end_date >= start_date)`);
};

module.exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE reservation_stays DROP CONSTRAINT IF EXISTS reservation_stays_end_date_gte_start_date`);
  pgm.sql(`ALTER TABLE reservation_stays ADD CONSTRAINT reservation_stays_end_date_after_start_date CHECK (end_date > start_date)`);
};
