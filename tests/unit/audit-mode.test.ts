import { describe, it, expect } from 'vitest';
import { ogMutationPathBusinessMode } from '../../src/domain/audit-mode.js';

describe('ogMutationPathBusinessMode', () => {
  it('returns live for live operational prefix', () => {
    expect(ogMutationPathBusinessMode('/live/properties/aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee/reservations')).toBe(
      'live',
    );
  });

  it('returns training for training operational prefix', () => {
    expect(ogMutationPathBusinessMode('/training/properties/aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee/holds')).toBe(
      'training',
    );
  });

  it('returns null when no live/training prefix', () => {
    expect(ogMutationPathBusinessMode('/organisations/uuid/properties/uuid/distribution-controls')).toBeNull();
  });
});
