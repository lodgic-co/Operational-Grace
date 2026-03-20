import { describe, it, expect, vi } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import {
  ResolveEnvironmentSchema,
  AssertPropertyPermission,
  BuildPropertyReservationsResponse,
  CreateReservationWithStays,
} from '../../src/domain/procedures.js';
import type { MeasuredJudgementClient } from '../../src/http/measured-judgement-client.js';
import { AppError } from '../../src/errors/index.js';

const ACTOR_UUID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const ORG_UUID = 'bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb';
const PROP_UUID = 'cccccccc-cccc-4ccc-accc-cccccccccccc';
const REQUEST_ID = 'dddddddd-dddd-4ddd-addd-dddddddddddd';

const mockLivePool = {} as Pool;
const mockTrainingPool = {} as Pool;

describe('ResolveEnvironmentSchema', () => {
  it('returns live pool and environment for live', () => {
    const result = ResolveEnvironmentSchema('live', mockLivePool, mockTrainingPool);
    expect(result.pool).toBe(mockLivePool);
    expect(result.environment).toBe('live');
  });

  it('returns training pool and environment for training', () => {
    const result = ResolveEnvironmentSchema('training', mockLivePool, mockTrainingPool);
    expect(result.pool).toBe(mockTrainingPool);
    expect(result.environment).toBe('training');
  });
});

describe('AssertPropertyPermission', () => {
  it('resolves when measured-judgement returns allowed:true', async () => {
    const mjClient: MeasuredJudgementClient = {
      checkPermission: vi.fn().mockResolvedValue({ allowed: true }),
    };

    await expect(
      AssertPropertyPermission(mjClient, ACTOR_UUID, ORG_UUID, PROP_UUID, 'reservations.view', REQUEST_ID),
    ).resolves.toBeUndefined();

    expect(mjClient.checkPermission).toHaveBeenCalledWith(
      ACTOR_UUID,
      ORG_UUID,
      'reservations.view',
      [PROP_UUID],
      REQUEST_ID,
      undefined,
    );
  });

  it('throws 404 not_found when allowed:false (non-leakage)', async () => {
    const mjClient: MeasuredJudgementClient = {
      checkPermission: vi.fn().mockResolvedValue({ allowed: false }),
    };

    await expect(
      AssertPropertyPermission(mjClient, ACTOR_UUID, ORG_UUID, PROP_UUID, 'reservations.view', REQUEST_ID),
    ).rejects.toMatchObject({ status: 404, code: 'not_found' });
  });

  it('re-throws AppError from measured-judgement unchanged', async () => {
    const appErr = new AppError({ status: 400, code: 'unknown_permission', message: 'Unknown', retryable: false });
    const mjClient: MeasuredJudgementClient = {
      checkPermission: vi.fn().mockRejectedValue(appErr),
    };

    await expect(
      AssertPropertyPermission(mjClient, ACTOR_UUID, ORG_UUID, PROP_UUID, 'reservations.view', REQUEST_ID),
    ).rejects.toThrow(appErr);
  });

  it('throws 502 bad_gateway when measured-judgement throws a non-AppError', async () => {
    const mjClient: MeasuredJudgementClient = {
      checkPermission: vi.fn().mockRejectedValue(new Error('connection refused')),
    };

    await expect(
      AssertPropertyPermission(mjClient, ACTOR_UUID, ORG_UUID, PROP_UUID, 'reservations.view', REQUEST_ID),
    ).rejects.toMatchObject({ status: 502, code: 'bad_gateway' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CreateReservationWithStays — validation tests (no DB required)
// ─────────────────────────────────────────────────────────────────────────────

function makePool(trx: Partial<PoolClient>): Pool {
  return {
    connect: vi.fn().mockResolvedValue({
      query: vi.fn(),
      release: vi.fn(),
      ...trx,
    }),
  } as unknown as Pool;
}

const PROP = '44444444-4444-4444-a444-444444444444';
const OPT_TYPE = '55555555-5555-4555-a555-555555555555';

const AUDIT_CTX = {
  actorUserUuid: ACTOR_UUID,
  organisationUuid: ORG_UUID,
  propertyUuid: PROP,
  requestId: REQUEST_ID,
};

describe('CreateReservationWithStays — pre-check validation', () => {
  it('rejects when stays array is empty', async () => {
    const pool = makePool({});
    await expect(
      CreateReservationWithStays('live', pool, pool, 'res-uuid', PROP, 'Guest', '2027-01-04', '2027-01-07', [], AUDIT_CTX),
    ).rejects.toMatchObject({ status: 400, code: 'invalid_request' });
  });

  it('rejects when reservation check_out equals check_in', async () => {
    const pool = makePool({});
    await expect(
      CreateReservationWithStays('live', pool, pool, 'res-uuid', PROP, 'Guest', '2027-01-07', '2027-01-07', [
        { accommodation_option_type_uuid: OPT_TYPE, start_date: '2027-01-07', end_date: '2027-01-07' },
      ], AUDIT_CTX),
    ).rejects.toMatchObject({ status: 400, code: 'invalid_request' });
  });

  it('rejects when reservation check_out is before check_in', async () => {
    const pool = makePool({});
    await expect(
      CreateReservationWithStays('live', pool, pool, 'res-uuid', PROP, 'Guest', '2027-01-07', '2027-01-04', [
        { accommodation_option_type_uuid: OPT_TYPE, start_date: '2027-01-04', end_date: '2027-01-07' },
      ], AUDIT_CTX),
    ).rejects.toMatchObject({ status: 400, code: 'invalid_request' });
  });

  it('accepts a single-night stay where end_date equals start_date', async () => {
    // Stay nights are inclusive: start_date=end_date means one night is valid.
    // The pool is reached but the mock is empty; the promise rejects with a
    // pool error rather than a validation error — that is sufficient to prove
    // the validation itself did not throw invalid_request.
    const pool = makePool({});
    await expect(
      CreateReservationWithStays('live', pool, pool, 'res-uuid', PROP, 'Guest', '2027-01-04', '2027-01-07', [
        { accommodation_option_type_uuid: OPT_TYPE, start_date: '2027-01-05', end_date: '2027-01-05' },
      ], AUDIT_CTX),
    ).rejects.not.toMatchObject({ status: 400, code: 'invalid_request' });
  });

  it('rejects a stay whose end_date equals the reservation check_out', async () => {
    // Stay nights are inclusive. If check_out is Jan 7 the last valid night is
    // Jan 6. A stay ending on check_out day is invalid.
    const pool = makePool({});
    await expect(
      CreateReservationWithStays('live', pool, pool, 'res-uuid', PROP, 'Guest', '2027-01-04', '2027-01-07', [
        { accommodation_option_type_uuid: OPT_TYPE, start_date: '2027-01-04', end_date: '2027-01-07' },
      ], AUDIT_CTX),
    ).rejects.toMatchObject({ status: 400, code: 'invalid_request' });
  });

  it('rejects when a stay end_date is before start_date', async () => {
    const pool = makePool({});
    await expect(
      CreateReservationWithStays('live', pool, pool, 'res-uuid', PROP, 'Guest', '2027-01-04', '2027-01-07', [
        { accommodation_option_type_uuid: OPT_TYPE, start_date: '2027-01-06', end_date: '2027-01-04' },
      ], AUDIT_CTX),
    ).rejects.toMatchObject({ status: 400, code: 'invalid_request' });
  });

  it('rejects a stay whose start_date is before the reservation check_in', async () => {
    const pool = makePool({});
    await expect(
      CreateReservationWithStays('live', pool, pool, 'res-uuid', PROP, 'Guest', '2027-01-04', '2027-01-07', [
        { accommodation_option_type_uuid: OPT_TYPE, start_date: '2027-01-03', end_date: '2027-01-06' },
      ], AUDIT_CTX),
    ).rejects.toMatchObject({ status: 400, code: 'invalid_request' });
  });

  it('rejects a stay whose end_date is after the reservation check_out', async () => {
    const pool = makePool({});
    await expect(
      CreateReservationWithStays('live', pool, pool, 'res-uuid', PROP, 'Guest', '2027-01-04', '2027-01-07', [
        { accommodation_option_type_uuid: OPT_TYPE, start_date: '2027-01-05', end_date: '2027-01-09' },
      ], AUDIT_CTX),
    ).rejects.toMatchObject({ status: 400, code: 'invalid_request' });
  });

  it('passes validation for multiple non-contiguous stays within the reservation envelope', async () => {
    // Two stays: nights Jan 4–5 and night Jan 6 (gap on Jan 5 is fine — stays are non-contiguous).
    // check_out is Jan 7; the last valid stay night is Jan 6 (check_out - 1 day).
    const trxQuery = vi.fn()
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // INSERT reservation — conflict, so no rows
      .mockResolvedValueOnce({ rows: [{ // SELECT reservation after conflict
        id: 1, uuid: 'res-uuid', property_uuid: PROP, guest_name: 'Guest',
        check_in: '2027-01-04', check_out: '2027-01-07', created_at: '2027-01-01T00:00:00.000000Z',
      }] })
      .mockResolvedValueOnce({ rows: [] }) // SELECT existing stays (was_existing=true path)
      .mockResolvedValueOnce({ rowCount: 1, rows: [] }) // INSERT audit_event ON CONFLICT DO NOTHING
      .mockResolvedValueOnce(undefined); // COMMIT

    const trx = { query: trxQuery, release: vi.fn() } as unknown as PoolClient;
    const pool = { connect: vi.fn().mockResolvedValue(trx) } as unknown as Pool;

    // Should not throw during validation phase
    await expect(
      CreateReservationWithStays('live', pool, pool, 'res-uuid', PROP, 'Guest', '2027-01-04', '2027-01-07', [
        { accommodation_option_type_uuid: OPT_TYPE, start_date: '2027-01-04', end_date: '2027-01-05' },
        { accommodation_option_type_uuid: OPT_TYPE, start_date: '2027-01-06', end_date: '2027-01-06' },
      ], AUDIT_CTX),
    ).resolves.toBeDefined();
  });

  it('passes validation for an unallocated stay where accommodation_option_uuid is null', async () => {
    const trxQuery = vi.fn()
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // INSERT reservation — conflict
      .mockResolvedValueOnce({ rows: [{ // SELECT reservation
        id: 1, uuid: 'res-uuid', property_uuid: PROP, guest_name: 'Guest',
        check_in: '2027-01-04', check_out: '2027-01-07', created_at: '2027-01-01T00:00:00.000000Z',
      }] })
      .mockResolvedValueOnce({ rows: [] }) // SELECT existing stays
      .mockResolvedValueOnce({ rowCount: 1, rows: [] }) // INSERT audit_event
      .mockResolvedValueOnce(undefined); // COMMIT

    const trx = { query: trxQuery, release: vi.fn() } as unknown as PoolClient;
    const pool = { connect: vi.fn().mockResolvedValue(trx) } as unknown as Pool;

    await expect(
      CreateReservationWithStays('live', pool, pool, 'res-uuid', PROP, 'Guest', '2027-01-04', '2027-01-07', [
        { accommodation_option_type_uuid: OPT_TYPE, accommodation_option_uuid: null, start_date: '2027-01-04', end_date: '2027-01-06' },
      ], AUDIT_CTX),
    ).resolves.toBeDefined();
  });
});

describe('BuildPropertyReservationsResponse', () => {
  it('strips id and created_at_iso, exposing only reservation_uuid', () => {
    const rows = [
      { id: 1, reservation_uuid: 'eeeeeeee-eeee-4eee-aeee-eeeeeeeeeeee', created_at_iso: '2026-03-12T00:00:00.000000Z' },
      { id: 2, reservation_uuid: 'ffffffff-ffff-4fff-afff-ffffffffffff', created_at_iso: '2026-03-12T00:00:00.000000Z' },
    ];

    const result = BuildPropertyReservationsResponse(rows, null);

    expect(result.reservations).toHaveLength(2);
    expect(result.reservations[0]).toStrictEqual({ reservation_uuid: 'eeeeeeee-eeee-4eee-aeee-eeeeeeeeeeee' });
    expect(result.reservations[1]).toStrictEqual({ reservation_uuid: 'ffffffff-ffff-4fff-afff-ffffffffffff' });
    expect(result.next_cursor).toBeNull();
    // id and created_at_iso must not appear in public response
    expect('id' in result.reservations[0]).toBe(false);
    expect('created_at_iso' in result.reservations[0]).toBe(false);
  });

  it('passes through next_cursor', () => {
    const result = BuildPropertyReservationsResponse([], 'some-opaque-cursor');
    expect(result.next_cursor).toBe('some-opaque-cursor');
  });
});
