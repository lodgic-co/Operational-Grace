module.exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS reservations (
      id          SERIAL PRIMARY KEY,
      uuid        UUID        NOT NULL DEFAULT gen_random_uuid(),
      property_uuid UUID      NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  pgm.sql(`
    CREATE UNIQUE INDEX IF NOT EXISTS reservations_uuid_idx
      ON reservations (uuid)
  `);

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS reservations_property_created_uuid_idx
      ON reservations (property_uuid, created_at ASC, uuid ASC)
  `);

  pgm.sql(`
    CREATE TRIGGER set_reservations_updated_at
      BEFORE UPDATE ON reservations
      FOR EACH ROW EXECUTE FUNCTION set_updated_at()
  `);
};

module.exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS reservations CASCADE`);
};
