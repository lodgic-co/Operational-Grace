// Dev seed: insert sample reservations for known dev property UUIDs.
// These UUIDs are consistent across all dev seeds in the platform.
// This migration runs once per schema (operational_grace and operational_grace_training).

const PROP1_UUID = '44444444-4444-4444-4444-444444444444';
const PROP2_UUID = '55555555-5555-5555-5555-555555555555';

// UUID prefix per schema so live and training reservations are never ambiguous
// in logs or traces, consistent with the dual-schema environment isolation pattern:
//   operational_grace          -> a0000000-…
//   operational_grace_training -> b0000000-…

module.exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO reservations (uuid, property_uuid)
    SELECT
      (CASE current_schema()
        WHEN 'operational_grace'          THEN 'a0000000-0000-0000-0000-00000000000'
        WHEN 'operational_grace_training' THEN 'b0000000-0000-0000-0000-00000000000'
      END || seq)::uuid,
      property_uuid::uuid
    FROM (VALUES
      ('1', '${PROP1_UUID}'),
      ('2', '${PROP1_UUID}'),
      ('3', '${PROP1_UUID}'),
      ('4', '${PROP2_UUID}'),
      ('5', '${PROP2_UUID}')
    ) AS t(seq, property_uuid)
    ON CONFLICT (uuid) DO NOTHING
  `);
};

module.exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM reservations
    WHERE uuid IN (
      'a0000000-0000-0000-0000-000000000001'::uuid,
      'a0000000-0000-0000-0000-000000000002'::uuid,
      'a0000000-0000-0000-0000-000000000003'::uuid,
      'a0000000-0000-0000-0000-000000000004'::uuid,
      'a0000000-0000-0000-0000-000000000005'::uuid,
      'b0000000-0000-0000-0000-000000000001'::uuid,
      'b0000000-0000-0000-0000-000000000002'::uuid,
      'b0000000-0000-0000-0000-000000000003'::uuid,
      'b0000000-0000-0000-0000-000000000004'::uuid,
      'b0000000-0000-0000-0000-000000000005'::uuid
    )
  `);
};
