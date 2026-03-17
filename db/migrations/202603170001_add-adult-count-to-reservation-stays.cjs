module.exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE reservation_stays
      ADD COLUMN adult_count integer NULL
  `);
};

module.exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE reservation_stays
      DROP COLUMN IF EXISTS adult_count
  `);
};
