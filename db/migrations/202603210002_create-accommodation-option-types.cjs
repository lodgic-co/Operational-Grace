/**
 * Minimal catalog mirror for considered_response.accommodation_option_types.
 * FetchOgBundle joins reservation_stays / holds to this table to filter
 * exclusive_use occupancy; the join requires rows to exist in operational_grace.
 *
 * No FK to reservations (I16). UUID is the stable cross-service identifier.
 */
module.exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE accommodation_option_types (
      uuid           uuid PRIMARY KEY,
      property_uuid  uuid NOT NULL,
      sale_basis     text NOT NULL
        CHECK (sale_basis IN ('per_unit', 'per_bed', 'composite', 'exclusive_use'))
    )
  `);

  pgm.sql(`
    CREATE INDEX accommodation_option_types_property_uuid_idx
      ON accommodation_option_types (property_uuid)
  `);
};

module.exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS accommodation_option_types CASCADE`);
};
