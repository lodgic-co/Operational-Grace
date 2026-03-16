module.exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE reservation_stays (
      id                             integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      uuid                           uuid NOT NULL DEFAULT gen_random_uuid(),
      reservation_id                 integer NOT NULL
        REFERENCES reservations(id) ON DELETE CASCADE,
      -- accommodation_option_type_uuid references considered-response conceptually.
      -- No database FK across service boundaries (I16 external_reference_rule).
      accommodation_option_type_uuid uuid NOT NULL,
      -- accommodation_option_uuid references considered-response conceptually.
      -- NULL means the stay is not yet allocated to a concrete sellable option.
      -- No database FK across service boundaries (I16 external_reference_rule).
      accommodation_option_uuid      uuid NULL,
      check_in                       date NOT NULL,
      check_out                      date NOT NULL,
      created_at                     timestamptz NOT NULL DEFAULT now(),
      updated_at                     timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT reservation_stays_uuid_key UNIQUE (uuid),
      CONSTRAINT reservation_stays_check_out_after_check_in CHECK (check_out > check_in)
    )
  `);

  pgm.sql(`
    CREATE UNIQUE INDEX reservation_stays_uuid_idx
      ON reservation_stays (uuid)
  `);

  pgm.sql(`
    CREATE INDEX reservation_stays_reservation_id_idx
      ON reservation_stays (reservation_id)
  `);

  pgm.sql(`
    CREATE TRIGGER set_reservation_stays_updated_at
      BEFORE UPDATE ON reservation_stays
      FOR EACH ROW EXECUTE FUNCTION set_updated_at()
  `);
};

module.exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS reservation_stays CASCADE`);
};
