/**
 * Adds check_in and check_out to the reservations table.
 *
 * Two-step approach: add nullable with a placeholder default so existing dev
 * rows satisfy the constraint, tighten to NOT NULL, then drop the defaults.
 * The placeholder date '1970-01-01' is intentional — this is pre-live dev data
 * only; no production rows exist at migration time.
 *
 * Applies to both operational_grace and operational_grace_training schemas
 * (schema-aware pool sets search_path at connection time).
 */
module.exports.up = (pgm) => {
  // Add as nullable with no default so existing rows stay NULL.
  pgm.sql(`ALTER TABLE reservations ADD COLUMN check_in  date NULL`);
  pgm.sql(`ALTER TABLE reservations ADD COLUMN check_out date NULL`);
  // Backfill existing rows with a valid placeholder (check_out strictly after
  // check_in) before tightening to NOT NULL and adding the CHECK constraint.
  pgm.sql(`UPDATE reservations SET check_in = '1900-01-01', check_out = '1900-01-02' WHERE check_in IS NULL`);
  pgm.sql(`ALTER TABLE reservations ALTER COLUMN check_in  SET NOT NULL`);
  pgm.sql(`ALTER TABLE reservations ALTER COLUMN check_out SET NOT NULL`);
  pgm.sql(`ALTER TABLE reservations ADD CONSTRAINT reservations_check_out_after_check_in CHECK (check_out > check_in)`);
};

module.exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE reservations DROP CONSTRAINT IF EXISTS reservations_check_out_after_check_in`);
  pgm.sql(`ALTER TABLE reservations DROP COLUMN IF EXISTS check_out`);
  pgm.sql(`ALTER TABLE reservations DROP COLUMN IF EXISTS check_in`);
};
