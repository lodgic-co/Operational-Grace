module.exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE reservation_stays
      DROP COLUMN accommodation_unit_uuid
  `);
};

module.exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE reservation_stays
      ADD COLUMN accommodation_unit_uuid uuid NULL
  `);
};
