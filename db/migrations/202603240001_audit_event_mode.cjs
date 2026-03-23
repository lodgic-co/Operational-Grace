/**
 * Audit v2 refinement — required business/runtime mode (contracts/audit-event-v2.yaml field_model.mode).
 * Applies to operational_grace and operational_grace_training (separate migrate runs per schema).
 */
module.exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE audit_event ADD COLUMN mode text
  `);
  pgm.sql(`
    UPDATE audit_event
       SET mode = CASE current_schema()
         WHEN 'operational_grace' THEN 'live'
         WHEN 'operational_grace_training' THEN 'training'
         ELSE 'none'
       END
     WHERE mode IS NULL
  `);
  pgm.sql(`ALTER TABLE audit_event ALTER COLUMN mode SET NOT NULL`);
  pgm.sql(`
    ALTER TABLE audit_event ADD CONSTRAINT audit_event_mode_v2_check
      CHECK (mode IN ('live', 'training', 'none'))
  `);
};

module.exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE audit_event DROP CONSTRAINT IF EXISTS audit_event_mode_v2_check`);
  pgm.sql(`ALTER TABLE audit_event DROP COLUMN IF EXISTS mode`);
};
