import { createHmac, timingSafeEqual } from 'crypto';
import { config } from '../config/index.js';
import { InvalidCursor } from '../errors/index.js';

/**
 * Cursor payload for reservation pagination.
 * c: ISO 8601 created_at of last row
 * u: uuid of last row
 */
interface CursorPayload {
  c: string;
  u: string;
}

function sign(payload: string): string {
  return createHmac('sha256', config.CURSOR_HMAC_SECRET)
    .update(payload)
    .digest('base64url');
}

export function encodeCursor(lastCreatedAt: string, lastUuid: string): string {
  const payload = JSON.stringify({ c: lastCreatedAt, u: lastUuid });
  const payloadB64 = Buffer.from(payload).toString('base64url');
  const signature = sign(payloadB64);
  return `${payloadB64}.${signature}`;
}

export function decodeCursor(cursor: string): { lastCreatedAt: string; lastUuid: string } {
  const dotIndex = cursor.indexOf('.');
  if (dotIndex === -1) {
    throw InvalidCursor('Malformed cursor');
  }

  const payloadB64 = cursor.slice(0, dotIndex);
  const signature = cursor.slice(dotIndex + 1);

  const expectedSignature = sign(payloadB64);
  const actualBuf = Buffer.from(signature, 'base64url');
  const expectedBuf = Buffer.from(expectedSignature, 'base64url');
  const signaturesMatch =
    actualBuf.length === expectedBuf.length && timingSafeEqual(actualBuf, expectedBuf);
  if (!signaturesMatch) {
    throw InvalidCursor('Invalid cursor signature');
  }

  let parsed: CursorPayload;
  try {
    const json = Buffer.from(payloadB64, 'base64url').toString('utf8');
    parsed = JSON.parse(json) as CursorPayload;
  } catch {
    throw InvalidCursor('Malformed cursor payload');
  }

  if (typeof parsed.c !== 'string' || typeof parsed.u !== 'string') {
    throw InvalidCursor('Malformed cursor payload');
  }

  return { lastCreatedAt: parsed.c, lastUuid: parsed.u };
}
