module.exports.up = (pgm) => {
  pgm.sql(`
    CREATE OR REPLACE FUNCTION set_updated_at()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $$
  `);
};

module.exports.down = (pgm) => {
  pgm.sql(`DROP FUNCTION IF EXISTS set_updated_at() CASCADE`);
};
