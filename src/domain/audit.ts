/**
 * Pure audit helpers — idempotency keys and structural metadata (no I/O).
 * Audit v2 operation names per contracts/audit-event-v2.yaml.
 */

export const EXECUTOR_SERVICE = 'operational-grace' as const;

export function reservationIdempotencyKey(reservationUuid: string): string {
  return `${EXECUTOR_SERVICE}:reservation_create:${reservationUuid}`;
}

export function holdIdempotencyKey(holdUuid: string): string {
  return `${EXECUTOR_SERVICE}:hold_create:${holdUuid}`;
}

/** Structural metadata for reservation_create — no PII (no guest_name). */
export function reservationAuditMetadata(checkIn: string, checkOut: string): Record<string, string> {
  return { check_in: checkIn, check_out: checkOut };
}

/** Structural metadata for hold_create — dates and expiry only. */
export function holdAuditMetadata(input: {
  check_in: string;
  check_out: string;
  expires_at: string;
}): Record<string, string> {
  return {
    check_in: input.check_in,
    check_out: input.check_out,
    expires_at: input.expires_at,
  };
}
