module.exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE holds (
      id                             integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      -- uuid is client-supplied for idempotence (hold_uuid in the request body).
      -- UNIQUE constraint enforces idempotent creation via ON CONFLICT (uuid) DO NOTHING.
      uuid                           uuid NOT NULL,
      -- property_uuid references the property in considered-response.
      -- No database FK across service boundaries (I16 external_reference_rule).
      property_uuid                  uuid NOT NULL,
      -- accommodation_option_type_uuid references considered-response.
      -- No database FK across service boundaries (I16 external_reference_rule).
      accommodation_option_type_uuid uuid NOT NULL,
      -- accommodation_option_uuid is optional. NULL means the hold is not yet
      -- allocated to a concrete sellable option.
      -- No database FK across service boundaries (I16 external_reference_rule).
      accommodation_option_uuid      uuid NULL,
      check_in                       date NOT NULL,
      check_out                      date NOT NULL,
      expires_at                     timestamptz NOT NULL,
      created_at                     timestamptz NOT NULL DEFAULT now(),
      updated_at                     timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT holds_uuid_key UNIQUE (uuid),
      CONSTRAINT holds_check_out_after_check_in CHECK (check_out > check_in)
    )
  `);

  pgm.sql(`
    CREATE UNIQUE INDEX holds_uuid_idx
      ON holds (uuid)
  `);

  pgm.sql(`
    CREATE INDEX holds_property_uuid_idx
      ON holds (property_uuid)
  `);

  pgm.sql(`
    CREATE TRIGGER set_holds_updated_at
      BEFORE UPDATE ON holds
      FOR EACH ROW EXECUTE FUNCTION set_updated_at()
  `);
};

module.exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS holds CASCADE`);
};
