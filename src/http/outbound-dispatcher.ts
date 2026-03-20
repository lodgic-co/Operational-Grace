import { Agent } from 'undici';

const outboundHttpDispatcher = new Agent({
  connections: 128,
  keepAliveTimeout: 60_000,
  keepAliveMaxTimeout: 600_000,
});

export function fetchOutbound(input: string | URL, init?: RequestInit): Promise<Response> {
  return fetch(input, {
    ...(init ?? {}),
    dispatcher: outboundHttpDispatcher,
  } as RequestInit);
}
