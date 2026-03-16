import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import type { MeasuredJudgementClient } from '../../src/http/measured-judgement-client.js';

const INTERNAL_SECRET = process.env['INTERNAL_SERVICE_SECRET'] ?? 'test-internal-secret';

const PROP_UUID = '11111111-1111-4111-a111-111111111111';
const PROP_UUID_2 = '22222222-2222-4222-a222-222222222222';
const ACTOR_UUID = '33333333-3333-4333-a333-333333333333';
const ORG_UUID = '44444444-4444-4444-a444-444444444444';
const UNKNOWN_PROP_UUID = 'ffffffff-ffff-4fff-afff-ffffffffffff';

let app: FastifyInstance;
let request: ReturnType<typeof supertest>;
let livePool: pg.Pool;
let trainingPool: pg.Pool;

const LIVE_SCHEMA = 'operational_grace';
const TRAINING_SCHEMA = 'operational_grace_training';

const allowedMjClient: MeasuredJudgementClient = {
  checkPermission: async () => ({ allowed: true }),
};
const deniedMjClient: MeasuredJudgementClient = {
  checkPermission: async () => ({ allowed: false }),
};
const errorMjClient: MeasuredJudgementClient = {
  checkPermission: async () => { throw new Error('connection refused'); },
};

async function seedReservations(pool: pg.Pool, schema: string): Promise<void> {
  await pool.query(`SET search_path TO ${schema}`);
  await pool.query(`
    INSERT INTO reservations (uuid, property_uuid, guest_name)
    VALUES
      ('aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa', $1::uuid, 'Seed Guest A'),
      ('bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb', $1::uuid, 'Seed Guest B'),
      ('cccccccc-cccc-4ccc-accc-cccccccccccc', $2::uuid, 'Seed Guest C')
    ON CONFLICT (uuid) DO NOTHING
  `, [PROP_UUID, PROP_UUID_2]);
}

function expectEnvelope(body: unknown, status: number, code: string): void {
  const b = body as { error?: { status?: number; code?: string } };
  expect(b?.error?.status).toBe(status);
  expect(b?.error?.code).toBe(code);
}

beforeAll(async () => {
  const dbUrl = process.env['DATABASE_URL'];
  if (!dbUrl) throw new Error('DATABASE_URL required for integration tests');

  livePool = new pg.Pool({ connectionString: dbUrl, max: 2 });
  trainingPool = new pg.Pool({ connectionString: dbUrl, max: 2 });

  await seedReservations(livePool, LIVE_SCHEMA);
  await seedReservations(trainingPool, TRAINING_SCHEMA);

  const { createApp } = await import('../../src/http/app.js');

  const testLivePool = new pg.Pool({ connectionString: dbUrl, max: 2 });
  const testTrainingPool = new pg.Pool({ connectionString: dbUrl, max: 2 });

  testLivePool.on('connect', (client) => { void client.query(`SET search_path TO ${LIVE_SCHEMA}`); });
  testTrainingPool.on('connect', (client) => { void client.query(`SET search_path TO ${TRAINING_SCHEMA}`); });

  app = createApp({ mjClient: allowedMjClient, livePool: testLivePool, trainingPool: testTrainingPool });
  await app.ready();
  request = supertest(app.server);
});

afterAll(async () => {
  await app.close();
  await livePool.end();
  await trainingPool.end();
});

describe('GET /health/live', () => {
  it('returns 200', async () => {
    const res = await request.get('/health/live');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

describe('GET /live/properties/:property_uuid/reservations', () => {
  it('returns 200 with reservation list for known property', async () => {
    const res = await request
      .get(`/live/properties/${PROP_UUID}/reservations`)
      .set('X-Internal-Secret', INTERNAL_SECRET)
      .set('X-Actor-Type', 'user')
      .set('X-Actor-User-Uuid', ACTOR_UUID)
      .set('X-Organisation-Uuid', ORG_UUID)
      .set('X-Property-Uuid', PROP_UUID);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.reservations)).toBe(true);
    expect(res.body.reservations.every((r: unknown) => typeof (r as { reservation_uuid: string }).reservation_uuid === 'string')).toBe(true);
    // id must not appear in public response
    expect(res.body.reservations.every((r: unknown) => !('id' in (r as object)))).toBe(true);
  });

  it('returns 400 for invalid property_uuid', async () => {
    const res = await request
      .get('/live/properties/not-a-uuid/reservations')
      .set('X-Internal-Secret', INTERNAL_SECRET)
      .set('X-Actor-Type', 'user')
      .set('X-Actor-User-Uuid', ACTOR_UUID)
      .set('X-Organisation-Uuid', ORG_UUID)
      .set('X-Property-Uuid', PROP_UUID);

    expect(res.status).toBe(400);
    expectEnvelope(res.body, 400, 'invalid_request');
  });

  it('returns 400 when delegated actor headers are missing', async () => {
    const res = await request
      .get(`/live/properties/${PROP_UUID}/reservations`)
      .set('X-Internal-Secret', INTERNAL_SECRET);

    expect(res.status).toBe(400);
    expectEnvelope(res.body, 400, 'invalid_request');
  });

  it('returns 401 when no auth credential provided', async () => {
    const res = await request
      .get(`/live/properties/${PROP_UUID}/reservations`)
      .set('X-Actor-Type', 'user')
      .set('X-Actor-User-Uuid', ACTOR_UUID)
      .set('X-Organisation-Uuid', ORG_UUID)
      .set('X-Property-Uuid', PROP_UUID);

    expect(res.status).toBe(401);
  });

  it('returns 404 not_found when measured-judgement denies access (non-leakage)', async () => {
    const { createApp } = await import('../../src/http/app.js');
    const dbUrl = process.env['DATABASE_URL']!;
    const pl = new pg.Pool({ connectionString: dbUrl, max: 1 });
    const tp = new pg.Pool({ connectionString: dbUrl, max: 1 });
    pl.on('connect', (c) => { void c.query(`SET search_path TO ${LIVE_SCHEMA}`); });
    tp.on('connect', (c) => { void c.query(`SET search_path TO ${TRAINING_SCHEMA}`); });

    const deniedApp = createApp({ mjClient: deniedMjClient, livePool: pl, trainingPool: tp });
    await deniedApp.ready();
    const deniedRequest = supertest(deniedApp.server);

    const res = await deniedRequest
      .get(`/live/properties/${UNKNOWN_PROP_UUID}/reservations`)
      .set('X-Internal-Secret', INTERNAL_SECRET)
      .set('X-Actor-Type', 'user')
      .set('X-Actor-User-Uuid', ACTOR_UUID)
      .set('X-Organisation-Uuid', ORG_UUID)
      .set('X-Property-Uuid', UNKNOWN_PROP_UUID);

    expect(res.status).toBe(404);
    expectEnvelope(res.body, 404, 'not_found');

    await deniedApp.close();
    await pl.end();
    await tp.end();
  });

  it('returns 502 bad_gateway when measured-judgement is unreachable', async () => {
    const { createApp } = await import('../../src/http/app.js');
    const dbUrl = process.env['DATABASE_URL']!;
    const pl = new pg.Pool({ connectionString: dbUrl, max: 1 });
    const tp = new pg.Pool({ connectionString: dbUrl, max: 1 });
    pl.on('connect', (c) => { void c.query(`SET search_path TO ${LIVE_SCHEMA}`); });
    tp.on('connect', (c) => { void c.query(`SET search_path TO ${TRAINING_SCHEMA}`); });

    const errorApp = createApp({ mjClient: errorMjClient, livePool: pl, trainingPool: tp });
    await errorApp.ready();
    const errorRequest = supertest(errorApp.server);

    const res = await errorRequest
      .get(`/live/properties/${PROP_UUID}/reservations`)
      .set('X-Internal-Secret', INTERNAL_SECRET)
      .set('X-Actor-Type', 'user')
      .set('X-Actor-User-Uuid', ACTOR_UUID)
      .set('X-Organisation-Uuid', ORG_UUID)
      .set('X-Property-Uuid', PROP_UUID);

    expect(res.status).toBe(502);
    expectEnvelope(res.body, 502, 'bad_gateway');

    await errorApp.close();
    await pl.end();
    await tp.end();
  });

  it('paginates results correctly using limit', async () => {
    const res = await request
      .get(`/live/properties/${PROP_UUID}/reservations?limit=1`)
      .set('X-Internal-Secret', INTERNAL_SECRET)
      .set('X-Actor-Type', 'user')
      .set('X-Actor-User-Uuid', ACTOR_UUID)
      .set('X-Organisation-Uuid', ORG_UUID)
      .set('X-Property-Uuid', PROP_UUID);

    expect(res.status).toBe(200);
    expect(res.body.reservations).toHaveLength(1);
    expect(typeof res.body.next_cursor).toBe('string');
  });

  it('returns second page when next_cursor from page 1 is supplied (M24)', async () => {
    const page1 = await request
      .get(`/live/properties/${PROP_UUID}/reservations?limit=1`)
      .set('X-Internal-Secret', INTERNAL_SECRET)
      .set('X-Actor-Type', 'user')
      .set('X-Actor-User-Uuid', ACTOR_UUID)
      .set('X-Organisation-Uuid', ORG_UUID)
      .set('X-Property-Uuid', PROP_UUID);

    expect(page1.status).toBe(200);
    const cursor = page1.body.next_cursor as string;
    expect(typeof cursor).toBe('string');

    const page2 = await request
      .get(`/live/properties/${PROP_UUID}/reservations?limit=1&cursor=${encodeURIComponent(cursor)}`)
      .set('X-Internal-Secret', INTERNAL_SECRET)
      .set('X-Actor-Type', 'user')
      .set('X-Actor-User-Uuid', ACTOR_UUID)
      .set('X-Organisation-Uuid', ORG_UUID)
      .set('X-Property-Uuid', PROP_UUID);

    expect(page2.status).toBe(200);
    expect(page2.body.reservations).toHaveLength(1);
    expect(page2.body.reservations[0].reservation_uuid).not.toBe(
      page1.body.reservations[0].reservation_uuid,
    );
  });

  it('returns 400 invalid_cursor for a tampered cursor (M34)', async () => {
    const res = await request
      .get(`/live/properties/${PROP_UUID}/reservations?cursor=dGVzdA.invalidsignature`)
      .set('X-Internal-Secret', INTERNAL_SECRET)
      .set('X-Actor-Type', 'user')
      .set('X-Actor-User-Uuid', ACTOR_UUID)
      .set('X-Organisation-Uuid', ORG_UUID)
      .set('X-Property-Uuid', PROP_UUID);

    expect(res.status).toBe(400);
    expectEnvelope(res.body, 400, 'invalid_cursor');
  });

  it('returns 400 invalid_cursor for a malformed cursor with no dot separator (M34)', async () => {
    const res = await request
      .get(`/live/properties/${PROP_UUID}/reservations?cursor=notacursoratall`)
      .set('X-Internal-Secret', INTERNAL_SECRET)
      .set('X-Actor-Type', 'user')
      .set('X-Actor-User-Uuid', ACTOR_UUID)
      .set('X-Organisation-Uuid', ORG_UUID)
      .set('X-Property-Uuid', PROP_UUID);

    expect(res.status).toBe(400);
    expectEnvelope(res.body, 400, 'invalid_cursor');
  });

  it('returns 400 when X-Property-Uuid header is missing (M16)', async () => {
    const res = await request
      .get(`/live/properties/${PROP_UUID}/reservations`)
      .set('X-Internal-Secret', INTERNAL_SECRET)
      .set('X-Actor-Type', 'user')
      .set('X-Actor-User-Uuid', ACTOR_UUID)
      .set('X-Organisation-Uuid', ORG_UUID);

    expect(res.status).toBe(400);
    expectEnvelope(res.body, 400, 'invalid_request');
  });

  it('returns 400 when X-Property-Uuid does not match path property_uuid (M16)', async () => {
    const res = await request
      .get(`/live/properties/${PROP_UUID}/reservations`)
      .set('X-Internal-Secret', INTERNAL_SECRET)
      .set('X-Actor-Type', 'user')
      .set('X-Actor-User-Uuid', ACTOR_UUID)
      .set('X-Organisation-Uuid', ORG_UUID)
      .set('X-Property-Uuid', PROP_UUID_2);

    expect(res.status).toBe(400);
    expectEnvelope(res.body, 400, 'invalid_request');
  });
});

describe('GET /training/properties/:property_uuid/reservations', () => {
  it('returns 200 from training schema (data isolated from live)', async () => {
    const res = await request
      .get(`/training/properties/${PROP_UUID}/reservations`)
      .set('X-Internal-Secret', INTERNAL_SECRET)
      .set('X-Actor-Type', 'user')
      .set('X-Actor-User-Uuid', ACTOR_UUID)
      .set('X-Organisation-Uuid', ORG_UUID)
      .set('X-Property-Uuid', PROP_UUID);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.reservations)).toBe(true);
    expect(res.body.reservations.every((r: unknown) => !('id' in (r as object)))).toBe(true);
  });

  it('returns 404 for path that does not match any route', async () => {
    const res = await request
      .get(`/unknown/properties/${PROP_UUID}/reservations`)
      .set('X-Internal-Secret', INTERNAL_SECRET)
      .set('X-Actor-Type', 'user')
      .set('X-Actor-User-Uuid', ACTOR_UUID)
      .set('X-Organisation-Uuid', ORG_UUID)
      .set('X-Property-Uuid', PROP_UUID);

    expect(res.status).toBe(404);
  });
});

// --- Schema cross-contamination tests (M37) ---
//
// These tests prove that live and training schemas are genuinely isolated.
// They must fail if the pools are swapped, if search_path is not set, or
// if a query accidentally targets the wrong schema.
//
// Strategy: use a dedicated property UUID that is seeded into exactly one
// schema at a time; verify the other schema returns zero rows for that UUID.

describe('live/training schema isolation (M37 cross-contamination)', () => {
  const ISOLATION_PROP = 'eeeeeeee-eeee-4eee-aeee-eeeeeeeeeeee';
  const ISOLATION_UUID_A = 'a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0';
  const ISOLATION_UUID_B = 'b0b0b0b0-b0b0-b0b0-b0b0-b0b0b0b0b0b0';

  async function clearIsolationProp(pool: pg.Pool, schema: string): Promise<void> {
    await pool.query(
      `DELETE FROM ${schema}.reservations WHERE property_uuid = $1::uuid`,
      [ISOLATION_PROP],
    );
  }

  async function seedIsolationProp(pool: pg.Pool, schema: string, uuid: string): Promise<void> {
    await pool.query(
      `INSERT INTO ${schema}.reservations (uuid, property_uuid, guest_name)
       VALUES ($1::uuid, $2::uuid, 'Isolation Seed Guest')
       ON CONFLICT (uuid) DO NOTHING`,
      [uuid, ISOLATION_PROP],
    );
  }

  function reservationRequest(env: 'live' | 'training') {
    return request
      .get(`/${env}/properties/${ISOLATION_PROP}/reservations`)
      .set('X-Internal-Secret', INTERNAL_SECRET)
      .set('X-Actor-Type', 'user')
      .set('X-Actor-User-Uuid', ACTOR_UUID)
      .set('X-Organisation-Uuid', ORG_UUID)
      .set('X-Property-Uuid', ISOLATION_PROP);
  }

  beforeEach(async () => {
    await clearIsolationProp(livePool, LIVE_SCHEMA);
    await clearIsolationProp(trainingPool, TRAINING_SCHEMA);
  });

  afterAll(async () => {
    await clearIsolationProp(livePool, LIVE_SCHEMA);
    await clearIsolationProp(trainingPool, TRAINING_SCHEMA);
  });

  it('live-only seed: /live returns the row, /training returns zero rows', async () => {
    await seedIsolationProp(livePool, LIVE_SCHEMA, ISOLATION_UUID_A);

    const liveRes = await reservationRequest('live');
    expect(liveRes.status).toBe(200);
    const liveUuids = (liveRes.body.reservations as Array<{ reservation_uuid: string }>)
      .map((r) => r.reservation_uuid);
    expect(liveUuids).toContain(ISOLATION_UUID_A);

    const trainingRes = await reservationRequest('training');
    expect(trainingRes.status).toBe(200);
    const trainingUuids = (trainingRes.body.reservations as Array<{ reservation_uuid: string }>)
      .map((r) => r.reservation_uuid);
    expect(trainingUuids).not.toContain(ISOLATION_UUID_A);
    expect(trainingUuids).toHaveLength(0);
  });

  it('training-only seed: /training returns the row, /live returns zero rows', async () => {
    await seedIsolationProp(trainingPool, TRAINING_SCHEMA, ISOLATION_UUID_B);

    const trainingRes = await reservationRequest('training');
    expect(trainingRes.status).toBe(200);
    const trainingUuids = (trainingRes.body.reservations as Array<{ reservation_uuid: string }>)
      .map((r) => r.reservation_uuid);
    expect(trainingUuids).toContain(ISOLATION_UUID_B);

    const liveRes = await reservationRequest('live');
    expect(liveRes.status).toBe(200);
    const liveUuids = (liveRes.body.reservations as Array<{ reservation_uuid: string }>)
      .map((r) => r.reservation_uuid);
    expect(liveUuids).not.toContain(ISOLATION_UUID_B);
    expect(liveUuids).toHaveLength(0);
  });

  it('both schemas seeded independently: each route sees only its own rows', async () => {
    await seedIsolationProp(livePool, LIVE_SCHEMA, ISOLATION_UUID_A);
    await seedIsolationProp(trainingPool, TRAINING_SCHEMA, ISOLATION_UUID_B);

    const liveRes = await reservationRequest('live');
    expect(liveRes.status).toBe(200);
    const liveUuids = (liveRes.body.reservations as Array<{ reservation_uuid: string }>)
      .map((r) => r.reservation_uuid);
    expect(liveUuids).toContain(ISOLATION_UUID_A);
    expect(liveUuids).not.toContain(ISOLATION_UUID_B);

    const trainingRes = await reservationRequest('training');
    expect(trainingRes.status).toBe(200);
    const trainingUuids = (trainingRes.body.reservations as Array<{ reservation_uuid: string }>)
      .map((r) => r.reservation_uuid);
    expect(trainingUuids).toContain(ISOLATION_UUID_B);
    expect(trainingUuids).not.toContain(ISOLATION_UUID_A);
  });
});
