/**
 * Renames reservation_stays.check_in → start_date and check_out → end_date.
 *
 * Rationale: check_in/check_out describe a guest-facing arrival/departure event.
 * A stay segment is an allocation — the nights assigned to an accommodation
 * option type. The correct names are start_date and end_date to reflect
 * allocation semantics rather than guest-event semantics.
 *
 * Also drops the old CHECK constraint and re-adds it under the correct name.
 *
 * Applies to both operational_grace and operational_grace_training schemas.
 */
module.exports.up = (pgm) => {
  pgm.sql(`ALTER TABLE reservation_stays DROP CONSTRAINT IF EXISTS reservation_stays_check_out_after_check_in`);
  pgm.sql(`ALTER TABLE reservation_stays RENAME COLUMN check_in  TO start_date`);
  pgm.sql(`ALTER TABLE reservation_stays RENAME COLUMN check_out TO end_date`);
  pgm.sql(`ALTER TABLE reservation_stays ADD CONSTRAINT reservation_stays_end_date_after_start_date CHECK (end_date > start_date)`);
};

module.exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE reservation_stays DROP CONSTRAINT IF EXISTS reservation_stays_end_date_after_start_date`);
  pgm.sql(`ALTER TABLE reservation_stays RENAME COLUMN start_date TO check_in`);
  pgm.sql(`ALTER TABLE reservation_stays RENAME COLUMN end_date   TO check_out`);
  pgm.sql(`ALTER TABLE reservation_stays ADD CONSTRAINT reservation_stays_check_out_after_check_in CHECK (check_out > check_in)`);
};
