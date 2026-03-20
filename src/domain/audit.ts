/**
 * Pure audit v1 helpers — idempotency keys and structural metadata (no I/O).
 * See baseline_audit_v1_per_service and docs/final_audit_vi.md.
 */

export const EXECUTOR_SERVICE = 'operational-grace' as const;

export function reservationIdempotencyKey(reservationUuid: string): string {
  return `${EXECUTOR_SERVICE}:reservation_created:${reservationUuid}`;
}

export function holdIdempotencyKey(holdUuid: string): string {
  return `${EXECUTOR_SERVICE}:hold_created:${holdUuid}`;
}

/** Structural metadata for reservation_created — no PII (no guest_name). */
export function reservationAuditMetadata(checkIn: string, checkOut: string): Record<string, string> {
  return { check_in: checkIn, check_out: checkOut };
}

/** Structural metadata for hold_created — dates and expiry only. */
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
