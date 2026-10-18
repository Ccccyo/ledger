import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createLocalId } from './id';

describe('local identifier generation', () => {
  it('uses randomUUID when Web Crypto provides it', () => {
    const id = createLocalId('plan', {
      randomUUID: () => '00000000-0000-4000-8000-000000000001',
    });

    assert.equal(id, '00000000-0000-4000-8000-000000000001');
  });

  it('creates unique prefixed identifiers without Web Crypto', () => {
    const first = createLocalId('plan', null);
    const second = createLocalId('plan', null);

    assert.match(first, /^plan-[a-z0-9]+-[a-z0-9]+-[a-z0-9]+$/);
    assert.match(second, /^plan-[a-z0-9]+-[a-z0-9]+-[a-z0-9]+$/);
    assert.notEqual(first, second);
  });
});
