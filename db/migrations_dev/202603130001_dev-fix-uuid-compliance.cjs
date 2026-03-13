// One-time migration to update dev seed UUIDs to RFC 4122 v4 compliant values.
// The original dev seeds used placeholder UUIDs that lacked a valid version
// nibble (char 13, must be 1-8) and variant nibble (char 17, must be 8/9/a/b).
// This migration runs once per schema (operational_grace and
// operational_grace_training) via run-seed-dev.cjs, so each schema only
// updates its own rows. No-op UPDATEs (0 rows matched) are harmless.

module.exports.up = (pgm) => {

  // ── reservations.uuid ───────────────────────────────────────────────────────
  // operational_grace reservations: a-prefix
  pgm.sql(`UPDATE reservations SET uuid = 'a0000000-0000-4000-a000-000000000001' WHERE uuid = 'a0000000-0000-0000-0000-000000000001'`);
  pgm.sql(`UPDATE reservations SET uuid = 'a0000000-0000-4000-a000-000000000002' WHERE uuid = 'a0000000-0000-0000-0000-000000000002'`);
  pgm.sql(`UPDATE reservations SET uuid = 'a0000000-0000-4000-a000-000000000003' WHERE uuid = 'a0000000-0000-0000-0000-000000000003'`);
  pgm.sql(`UPDATE reservations SET uuid = 'a0000000-0000-4000-a000-000000000004' WHERE uuid = 'a0000000-0000-0000-0000-000000000004'`);
  pgm.sql(`UPDATE reservations SET uuid = 'a0000000-0000-4000-a000-000000000005' WHERE uuid = 'a0000000-0000-0000-0000-000000000005'`);

  // operational_grace_training reservations: b-prefix
  pgm.sql(`UPDATE reservations SET uuid = 'b0000000-0000-4000-b000-000000000001' WHERE uuid = 'b0000000-0000-0000-0000-000000000001'`);
  pgm.sql(`UPDATE reservations SET uuid = 'b0000000-0000-4000-b000-000000000002' WHERE uuid = 'b0000000-0000-0000-0000-000000000002'`);
  pgm.sql(`UPDATE reservations SET uuid = 'b0000000-0000-4000-b000-000000000003' WHERE uuid = 'b0000000-0000-0000-0000-000000000003'`);
  pgm.sql(`UPDATE reservations SET uuid = 'b0000000-0000-4000-b000-000000000004' WHERE uuid = 'b0000000-0000-0000-0000-000000000004'`);
  pgm.sql(`UPDATE reservations SET uuid = 'b0000000-0000-4000-b000-000000000005' WHERE uuid = 'b0000000-0000-0000-0000-000000000005'`);

  // ── reservations.property_uuid ───────────────────────────────────────────────

  pgm.sql(`UPDATE reservations
    SET property_uuid = '44444444-4444-4444-a444-444444444444'
    WHERE property_uuid = '44444444-4444-4444-4444-444444444444'`);

  pgm.sql(`UPDATE reservations
    SET property_uuid = '55555555-5555-4555-a555-555555555555'
    WHERE property_uuid = '55555555-5555-5555-5555-555555555555'`);
};

module.exports.down = (pgm) => {
  pgm.sql(`UPDATE reservations SET uuid = 'a0000000-0000-0000-0000-000000000001' WHERE uuid = 'a0000000-0000-4000-a000-000000000001'`);
  pgm.sql(`UPDATE reservations SET uuid = 'a0000000-0000-0000-0000-000000000002' WHERE uuid = 'a0000000-0000-4000-a000-000000000002'`);
  pgm.sql(`UPDATE reservations SET uuid = 'a0000000-0000-0000-0000-000000000003' WHERE uuid = 'a0000000-0000-4000-a000-000000000003'`);
  pgm.sql(`UPDATE reservations SET uuid = 'a0000000-0000-0000-0000-000000000004' WHERE uuid = 'a0000000-0000-4000-a000-000000000004'`);
  pgm.sql(`UPDATE reservations SET uuid = 'a0000000-0000-0000-0000-000000000005' WHERE uuid = 'a0000000-0000-4000-a000-000000000005'`);
  pgm.sql(`UPDATE reservations SET uuid = 'b0000000-0000-0000-0000-000000000001' WHERE uuid = 'b0000000-0000-4000-b000-000000000001'`);
  pgm.sql(`UPDATE reservations SET uuid = 'b0000000-0000-0000-0000-000000000002' WHERE uuid = 'b0000000-0000-4000-b000-000000000002'`);
  pgm.sql(`UPDATE reservations SET uuid = 'b0000000-0000-0000-0000-000000000003' WHERE uuid = 'b0000000-0000-4000-b000-000000000003'`);
  pgm.sql(`UPDATE reservations SET uuid = 'b0000000-0000-0000-0000-000000000004' WHERE uuid = 'b0000000-0000-4000-b000-000000000004'`);
  pgm.sql(`UPDATE reservations SET uuid = 'b0000000-0000-0000-0000-000000000005' WHERE uuid = 'b0000000-0000-4000-b000-000000000005'`);
  pgm.sql(`UPDATE reservations SET property_uuid = '44444444-4444-4444-4444-444444444444' WHERE property_uuid = '44444444-4444-4444-a444-444444444444'`);
  pgm.sql(`UPDATE reservations SET property_uuid = '55555555-5555-5555-5555-555555555555' WHERE property_uuid = '55555555-5555-4555-a555-555555555555'`);
};
