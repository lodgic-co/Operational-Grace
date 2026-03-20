import type { PoolClient } from 'pg';

export interface AuditMutationContext {
  actorUserUuid: string;
  organisationUuid: string;
  propertyUuid: string;
  requestId: string;
}

export interface AuditEventInsertInput {
  idempotencyKey: string;
  eventName: string;
  occurredAt: Date;
  recordedAt: Date;
  actorUserUuid: string;
  executorService: string;
  organisationUuid: string;
  propertyUuid: string;
  targetType: string;
  targetUuid: string;
  requestId: string;
  metadata: Record<string, unknown>;
  changeSet: unknown[] | null;
}

/**
 * Idempotent audit row insert — duplicate idempotency_key is a no-op (ON CONFLICT DO NOTHING).
 */
export async function insertAuditEventRow(trx: PoolClient, input: AuditEventInsertInput): Promise<void> {
  await trx.query(
    `INSERT INTO audit_event (
       idempotency_key, event_name, occurred_at, recorded_at,
       actor_user_uuid, executor_service, organisation_uuid, property_uuid,
       target_type, target_uuid, request_id, outcome, metadata, change_set
     ) VALUES (
       $1, $2, $3, $4, $5::uuid, $6, $7::uuid, $8::uuid, $9, $10::uuid, $11, $12, $13::jsonb, $14::jsonb
     )
     ON CONFLICT (idempotency_key) DO NOTHING`,
    [
      input.idempotencyKey,
      input.eventName,
      input.occurredAt.toISOString(),
      input.recordedAt.toISOString(),
      input.actorUserUuid,
      input.executorService,
      input.organisationUuid,
      input.propertyUuid,
      input.targetType,
      input.targetUuid,
      input.requestId,
      'succeeded',
      JSON.stringify(input.metadata),
      input.changeSet === null ? null : JSON.stringify(input.changeSet),
    ],
  );
}
