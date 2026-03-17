module.exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE holds
      ADD COLUMN adult_count integer NULL
  `);
};

module.exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE holds
      DROP COLUMN IF EXISTS adult_count
  `);
};
