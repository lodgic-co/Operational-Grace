/**
 * Audit v1 per baseline_audit_v1_per_service. Applies to both operational_grace and
 * operational_grace_training (separate node-pg-migrate runs per schema).
 */
module.exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE audit_event (
      audit_event_uuid uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      idempotency_key text NOT NULL,
      event_name text NOT NULL,
      occurred_at timestamptz NOT NULL,
      recorded_at timestamptz NOT NULL,
      actor_user_uuid uuid NOT NULL,
      executor_service text NOT NULL,
      organisation_uuid uuid NOT NULL,
      property_uuid uuid NOT NULL,
      target_type text NOT NULL,
      target_uuid uuid NOT NULL,
      request_id text NOT NULL,
      outcome text NOT NULL,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      reason_code text NULL,
      change_set jsonb NULL,
      actor_type text NULL,
      CONSTRAINT audit_event_outcome_succeeded CHECK (outcome = 'succeeded')
    )
  `);

  pgm.sql(`
    CREATE UNIQUE INDEX audit_event_idempotency_key_uidx ON audit_event (idempotency_key)
  `);
};

module.exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS audit_event`);
};
