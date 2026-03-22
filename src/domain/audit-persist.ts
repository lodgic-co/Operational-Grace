import type { Pool, PoolClient } from 'pg';

export type AuditActorType = 'user' | 'service' | 'system' | 'anonymous';

/** Success-path mutation audit context (user-identified delegated actor on reservation/hold routes). */
export interface AuditMutationContext {
  workId: string;
  actorUserUuid: string;
  organisationUuid: string;
  propertyUuid: string;
}

export interface TerminalSuccessAuditInput {
  idempotencyKey: string;
  eventName: string;
  occurredAt: Date;
  recordedAt: Date;
  actorType: AuditActorType;
  actorUserUuid: string | null;
  executorService: string;
  organisationUuid: string | null;
  propertyUuid: string | null;
  targetType: string;
  targetUuid: string | null;
  workId: string;
  workKind: 'request' | 'job' | 'workflow_step' | 'system_action';
  outcomeFamily: 'success';
  outcome: 'succeeded' | 'replayed';
  metadata: Record<string, unknown>;
  changeSet: unknown[] | null;
}

export interface TerminalNonSuccessAuditInput {
  eventName: string;
  occurredAt: Date;
  recordedAt: Date;
  actorType: AuditActorType;
  actorUserUuid: string | null;
  executorService: string;
  organisationUuid: string | null;
  propertyUuid: string | null;
  targetType: string;
  targetUuid: string | null;
  workId: string;
  workKind: 'request' | 'job' | 'workflow_step' | 'system_action';
  outcomeFamily: 'rejection' | 'failure';
  outcome: 'rejected' | 'failed';
  reasonCode: string;
  metadata: Record<string, unknown>;
}

/**
 * Idempotent success/replayed audit insert — duplicate success idempotency_key is a no-op.
 */
export async function insertTerminalSuccessAudit(trx: PoolClient, input: TerminalSuccessAuditInput): Promise<void> {
  await trx.query(
    `INSERT INTO audit_event (
       idempotency_key, event_name, occurred_at, recorded_at,
       actor_user_uuid, actor_type, executor_service, organisation_uuid, property_uuid,
       target_type, target_uuid, work_id, work_kind, outcome_family, outcome, reason_code,
       metadata, change_set
     ) VALUES (
       $1, $2, $3, $4, $5::uuid, $6, $7, $8::uuid, $9::uuid, $10, $11::uuid, $12, $13, $14, $15, NULL,
       $16::jsonb, $17::jsonb
     )
     ON CONFLICT (idempotency_key) WHERE (outcome IN ('succeeded', 'replayed')) DO NOTHING`,
    [
      input.idempotencyKey,
      input.eventName,
      input.occurredAt.toISOString(),
      input.recordedAt.toISOString(),
      input.actorUserUuid,
      input.actorType,
      input.executorService,
      input.organisationUuid,
      input.propertyUuid,
      input.targetType,
      input.targetUuid,
      input.workId,
      input.workKind,
      input.outcomeFamily,
      input.outcome,
      JSON.stringify(input.metadata),
      input.changeSet === null ? null : JSON.stringify(input.changeSet),
    ],
  );
}

/**
 * Separate short transaction for terminal rejection/failure (I19). idempotency_key omitted.
 */
export async function persistTerminalNonSuccessAudit(pool: Pool, input: TerminalNonSuccessAuditInput): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO audit_event (
         idempotency_key, event_name, occurred_at, recorded_at,
         actor_user_uuid, actor_type, executor_service, organisation_uuid, property_uuid,
         target_type, target_uuid, work_id, work_kind, outcome_family, outcome, reason_code,
         metadata, change_set
       ) VALUES (
         NULL, $1, $2, $3, $4::uuid, $5, $6, $7::uuid, $8::uuid, $9, $10::uuid, $11, $12, $13, $14, $15,
         $16::jsonb, NULL
       )`,
      [
        input.eventName,
        input.occurredAt.toISOString(),
        input.recordedAt.toISOString(),
        input.actorUserUuid,
        input.actorType,
        input.executorService,
        input.organisationUuid,
        input.propertyUuid,
        input.targetType,
        input.targetUuid,
        input.workId,
        input.workKind,
        input.outcomeFamily,
        input.outcome,
        input.reasonCode,
        JSON.stringify(input.metadata),
      ],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
