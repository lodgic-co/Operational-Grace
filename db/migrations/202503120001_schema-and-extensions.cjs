module.exports.up = (pgm) => {
  pgm.sql(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
};

module.exports.down = (_pgm) => {
  // Extensions are database-level; not dropped per-schema migration.
};
