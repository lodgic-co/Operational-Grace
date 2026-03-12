import { describe, it, expect, vi } from 'vitest';
import type { Pool } from 'pg';
import {
  ResolveEnvironmentSchema,
  AssertPropertyPermission,
  BuildPropertyReservationsResponse,
} from '../../src/domain/procedures.js';
import type { MeasuredJudgementClient } from '../../src/http/measured-judgement-client.js';
import { AppError } from '../../src/errors/index.js';

const ACTOR_UUID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ORG_UUID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const PROP_UUID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const REQUEST_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

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

describe('BuildPropertyReservationsResponse', () => {
  it('strips id and created_at, exposing only reservation_uuid', () => {
    const rows = [
      { id: 1, reservation_uuid: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', created_at: new Date() },
      { id: 2, reservation_uuid: 'ffffffff-ffff-ffff-ffff-ffffffffffff', created_at: new Date() },
    ];

    const result = BuildPropertyReservationsResponse(rows, null);

    expect(result.reservations).toHaveLength(2);
    expect(result.reservations[0]).toStrictEqual({ reservation_uuid: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee' });
    expect(result.reservations[1]).toStrictEqual({ reservation_uuid: 'ffffffff-ffff-ffff-ffff-ffffffffffff' });
    expect(result.next_cursor).toBeNull();
    // id must not appear in public response
    expect('id' in result.reservations[0]).toBe(false);
    expect('created_at' in result.reservations[0]).toBe(false);
  });

  it('passes through next_cursor', () => {
    const result = BuildPropertyReservationsResponse([], 'some-opaque-cursor');
    expect(result.next_cursor).toBe('some-opaque-cursor');
  });
});
