import { describe, it, expect } from 'vitest';
import {
  EXECUTOR_SERVICE,
  reservationIdempotencyKey,
  holdIdempotencyKey,
  reservationAuditMetadata,
} from '../../src/domain/audit.js';

describe('audit v1 pure helpers', () => {
  it('builds executor service constant', () => {
    expect(EXECUTOR_SERVICE).toBe('operational-grace');
  });

  it('builds stable reservation idempotency key', () => {
    const u = '88888888-8888-4888-a888-888888888888';
    expect(reservationIdempotencyKey(u)).toBe(`operational-grace:reservation_created:${u}`);
  });

  it('builds stable hold idempotency key', () => {
    const u = '99999999-9999-4999-a999-999999999999';
    expect(holdIdempotencyKey(u)).toBe(`operational-grace:hold_created:${u}`);
  });

  it('reservation metadata has no guest name', () => {
    expect(reservationAuditMetadata('2027-01-04', '2027-01-07')).toEqual({
      check_in: '2027-01-04',
      check_out: '2027-01-07',
    });
  });
});
