// Removes the placeholder reservations inserted by the original dev seed
// (202603120001_dev-seed.cjs). Those rows used a truncated schema that
// predates guest_name, check_in, check_out, and accommodation fields.
// Clean data can now be created via the API.

module.exports.up = (pgm) => {
  pgm.sql(`
    DELETE FROM reservations
    WHERE uuid IN (
      'a0000000-0000-4000-a000-000000000001',
      'a0000000-0000-4000-a000-000000000002',
      'a0000000-0000-4000-a000-000000000003',
      'a0000000-0000-4000-a000-000000000004',
      'a0000000-0000-4000-a000-000000000005',
      'b0000000-0000-4000-b000-000000000001',
      'b0000000-0000-4000-b000-000000000002',
      'b0000000-0000-4000-b000-000000000003',
      'b0000000-0000-4000-b000-000000000004',
      'b0000000-0000-4000-b000-000000000005'
    )
  `);
};

module.exports.down = (_pgm) => {
  // No restore — these rows are intentionally removed.
};
