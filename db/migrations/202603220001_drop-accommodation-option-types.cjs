/**
 * Drops operational_grace.accommodation_option_types — no longer used after SC derives
 * EU blocking from CR sale_basis + OG occupancy_by_aot_and_date (see exclusive-use-blocks proposal).
 */
module.exports.up = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS accommodation_option_types CASCADE`);
};

module.exports.down = (pgm) => {
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
