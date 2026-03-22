/**
 * Audit v2 terminal outcomes — baseline_audit_v2_terminal_outcomes, contracts/audit-event-v2.yaml.
 * Applies to operational_grace and operational_grace_training (separate migrate runs per schema).
 */
module.exports.up = (pgm) => {
  pgm.sql(`ALTER TABLE audit_event DROP CONSTRAINT IF EXISTS audit_event_outcome_succeeded`);
  pgm.sql(`DROP INDEX IF EXISTS audit_event_idempotency_key_uidx`);

  pgm.sql(`ALTER TABLE audit_event RENAME COLUMN request_id TO work_id`);

  pgm.sql(`ALTER TABLE audit_event ALTER COLUMN idempotency_key DROP NOT NULL`);
  pgm.sql(`ALTER TABLE audit_event ALTER COLUMN actor_user_uuid DROP NOT NULL`);
  pgm.sql(`ALTER TABLE audit_event ALTER COLUMN organisation_uuid DROP NOT NULL`);
  pgm.sql(`ALTER TABLE audit_event ALTER COLUMN property_uuid DROP NOT NULL`);
  pgm.sql(`ALTER TABLE audit_event ALTER COLUMN target_uuid DROP NOT NULL`);

  pgm.sql(`
    ALTER TABLE audit_event ADD COLUMN work_kind text NOT NULL DEFAULT 'request'
  `);
  pgm.sql(`
    ALTER TABLE audit_event ADD COLUMN outcome_family text NOT NULL DEFAULT 'success'
  `);

  pgm.sql(`UPDATE audit_event SET actor_type = COALESCE(actor_type, 'user')`);
  pgm.sql(`ALTER TABLE audit_event ALTER COLUMN actor_type SET NOT NULL`);
  pgm.sql(`ALTER TABLE audit_event ALTER COLUMN actor_type SET DEFAULT 'user'`);

  pgm.sql(`
    ALTER TABLE audit_event ADD CONSTRAINT audit_event_outcome_v2_check
      CHECK (outcome IN ('succeeded', 'replayed', 'rejected', 'failed'))
  `);
  pgm.sql(`
    ALTER TABLE audit_event ADD CONSTRAINT audit_event_outcome_family_v2_check
      CHECK (outcome_family IN ('success', 'rejection', 'failure'))
  `);
  pgm.sql(`
    ALTER TABLE audit_event ADD CONSTRAINT audit_event_outcome_family_align_check
      CHECK (
        (outcome IN ('succeeded', 'replayed') AND outcome_family = 'success')
        OR (outcome = 'rejected' AND outcome_family = 'rejection')
        OR (outcome = 'failed' AND outcome_family = 'failure')
      )
  `);
  pgm.sql(`
    ALTER TABLE audit_event ADD CONSTRAINT audit_event_reason_code_v2_check
      CHECK (
        (outcome IN ('succeeded', 'replayed') AND reason_code IS NULL)
        OR (outcome IN ('rejected', 'failed') AND reason_code IS NOT NULL)
      )
  `);
  pgm.sql(`
    ALTER TABLE audit_event ADD CONSTRAINT audit_event_actor_user_v2_check
      CHECK (
        (actor_type = 'user' AND actor_user_uuid IS NOT NULL)
        OR (actor_type <> 'user' AND actor_user_uuid IS NULL)
      )
  `);

  pgm.sql(`
    CREATE UNIQUE INDEX audit_event_idempotency_success_uidx
      ON audit_event (idempotency_key)
      WHERE outcome IN ('succeeded', 'replayed') AND idempotency_key IS NOT NULL
  `);
};

module.exports.down = (pgm) => {
  pgm.sql(`DROP INDEX IF EXISTS audit_event_idempotency_success_uidx`);
  pgm.sql(`ALTER TABLE audit_event DROP CONSTRAINT IF EXISTS audit_event_actor_user_v2_check`);
  pgm.sql(`ALTER TABLE audit_event DROP CONSTRAINT IF EXISTS audit_event_reason_code_v2_check`);
  pgm.sql(`ALTER TABLE audit_event DROP CONSTRAINT IF EXISTS audit_event_outcome_family_align_check`);
  pgm.sql(`ALTER TABLE audit_event DROP CONSTRAINT IF EXISTS audit_event_outcome_family_v2_check`);
  pgm.sql(`ALTER TABLE audit_event DROP CONSTRAINT IF EXISTS audit_event_outcome_v2_check`);
  pgm.sql(`ALTER TABLE audit_event DROP COLUMN IF EXISTS outcome_family`);
  pgm.sql(`ALTER TABLE audit_event DROP COLUMN IF EXISTS work_kind`);
  pgm.sql(`ALTER TABLE audit_event RENAME COLUMN work_id TO request_id`);
  pgm.sql(`
    ALTER TABLE audit_event ADD CONSTRAINT audit_event_outcome_succeeded CHECK (outcome = 'succeeded')
  `);
  pgm.sql(`ALTER TABLE audit_event ALTER COLUMN idempotency_key SET NOT NULL`);
  pgm.sql(`ALTER TABLE audit_event ALTER COLUMN actor_user_uuid SET NOT NULL`);
  pgm.sql(`ALTER TABLE audit_event ALTER COLUMN organisation_uuid SET NOT NULL`);
  pgm.sql(`ALTER TABLE audit_event ALTER COLUMN property_uuid SET NOT NULL`);
  pgm.sql(`ALTER TABLE audit_event ALTER COLUMN target_uuid SET NOT NULL`);
  pgm.sql(`
    CREATE UNIQUE INDEX audit_event_idempotency_key_uidx ON audit_event (idempotency_key)
  `);
};
