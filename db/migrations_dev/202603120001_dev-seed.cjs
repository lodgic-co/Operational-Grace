// Superseded. Original content inserted placeholder reservations that
// predated the current schema (guest_name, check_in, check_out, etc.).
// Kept as a stub so the recorded migration entry in the dev table stays
// consistent. Cleanup of any rows inserted by the original run is handled
// by 202603160103_dev-cleanup-placeholder-reservations.cjs.

module.exports.up = (_pgm) => {};
module.exports.down = (_pgm) => {};
