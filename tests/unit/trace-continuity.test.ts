import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as otelApi from '@opentelemetry/api';

const ACTOR_UUID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const ORG_UUID = 'bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb';
const PROP_UUID = 'cccccccc-cccc-4ccc-accc-cccccccccccc';
const REQUEST_ID = 'dddddddd-dddd-4ddd-addd-dddddddddddd';

function makeFetchMock() {
  return vi.fn().mockImplementation((url: string) => {
    if (url.includes('/oauth/token')) {
      return Promise.resolve(
        new Response(JSON.stringify({ access_token: 'test-m2m-token', expires_in: 3600 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }
    return Promise.resolve(
      new Response(JSON.stringify({ allowed: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });
}

describe('MJ client trace context propagation', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('wraps the outbound fetch in context.with when inboundSpan is provided', async () => {
    const contextWithSpy = vi.spyOn(otelApi.context, 'with');
    global.fetch = makeFetchMock();

    const mockSpan = {
      spanContext: () => ({
        traceId: 'aabbccddeeff00112233445566778899',
        spanId: '0011223344556677',
        traceFlags: 1,
      }),
      isRecording: () => true,
    } as unknown as otelApi.Span;

    const { createMeasuredJudgementClient } = await import(
      '../../src/http/measured-judgement-client.js'
    );
    const client = createMeasuredJudgementClient('http://mj.internal');

    await client.checkPermission(
      ACTOR_UUID,
      ORG_UUID,
      'reservations.view',
      [PROP_UUID],
      REQUEST_ID,
      mockSpan,
    );

    expect(contextWithSpy).toHaveBeenCalled();
    const capturedCtx = contextWithSpy.mock.calls[0][0];
    const spanFromCtx = otelApi.trace.getSpan(capturedCtx);
    expect(spanFromCtx).toBe(mockSpan);
  });

  it('falls back to context.active() when inboundSpan is null', async () => {
    const activeCtx = otelApi.context.active();
    const contextWithSpy = vi.spyOn(otelApi.context, 'with');
    global.fetch = makeFetchMock();

    const { createMeasuredJudgementClient } = await import(
      '../../src/http/measured-judgement-client.js'
    );
    const client = createMeasuredJudgementClient('http://mj.internal');

    await client.checkPermission(
      ACTOR_UUID,
      ORG_UUID,
      'reservations.view',
      [PROP_UUID],
      REQUEST_ID,
      null,
    );

    expect(contextWithSpy).toHaveBeenCalled();
    const capturedCtx = contextWithSpy.mock.calls[0][0];
    expect(capturedCtx).toBe(activeCtx);
  });

  it('throws GatewayTimeout (504) after exhausting retries on TimeoutError', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/oauth/token')) {
        return Promise.resolve(
          new Response(JSON.stringify({ access_token: 'test-m2m-token', expires_in: 3600 }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      return Promise.reject(new DOMException('The operation timed out.', 'TimeoutError'));
    });

    const { createMeasuredJudgementClient } = await import(
      '../../src/http/measured-judgement-client.js'
    );
    const { AppError } = await import('../../src/errors/index.js');
    const client = createMeasuredJudgementClient('http://mj.internal');

    await expect(
      client.checkPermission(ACTOR_UUID, ORG_UUID, 'reservations.view', [PROP_UUID], REQUEST_ID, null),
    ).rejects.toSatisfy((err: unknown) => {
      return err instanceof AppError && err.status === 504 && err.code === 'gateway_timeout';
    });
  });

  it('inboundSpan is threaded from AssertPropertyPermission to checkPermission', async () => {
    const mockSpan = {
      spanContext: () => ({
        traceId: 'aabbccddeeff00112233445566778899',
        spanId: '0011223344556677',
        traceFlags: 1,
      }),
      isRecording: () => true,
    } as unknown as otelApi.Span;

    const checkPermissionSpy = vi.fn().mockResolvedValue({ allowed: true });
    const mockMjClient = { checkPermission: checkPermissionSpy };

    const { AssertPropertyPermission } = await import(
      '../../src/domain/procedures.js'
    );

    await AssertPropertyPermission(
      mockMjClient,
      ACTOR_UUID,
      ORG_UUID,
      PROP_UUID,
      'reservations.view',
      REQUEST_ID,
      mockSpan,
    );

    expect(checkPermissionSpy).toHaveBeenCalledWith(
      ACTOR_UUID,
      ORG_UUID,
      'reservations.view',
      [PROP_UUID],
      REQUEST_ID,
      mockSpan,
    );
  });
});
