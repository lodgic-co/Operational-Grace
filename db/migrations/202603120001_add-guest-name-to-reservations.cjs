/**
 * Two-step migration: add guest_name as nullable with a default first,
 * then tighten to NOT NULL. This allows the migration to run against a
 * live table with existing rows without requiring a backfill transaction.
 * Existing rows receive an empty string default.
 */
module.exports.up = (pgm) => {
  pgm.sql(`ALTER TABLE reservations ADD COLUMN guest_name text NULL DEFAULT ''`);
  pgm.sql(`UPDATE reservations SET guest_name = '' WHERE guest_name IS NULL`);
  pgm.sql(`ALTER TABLE reservations ALTER COLUMN guest_name SET NOT NULL`);
  pgm.sql(`ALTER TABLE reservations ALTER COLUMN guest_name DROP DEFAULT`);
};

module.exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE reservations DROP COLUMN IF EXISTS guest_name`);
};
