module.exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE reservation_stays
      ADD COLUMN accommodation_unit_uuid uuid NULL
  `);
};

module.exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE reservation_stays
      DROP COLUMN IF EXISTS accommodation_unit_uuid
  `);
};
