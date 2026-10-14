import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createLifePlanInput } from '../calculation';
import {
  clearQuickPlanHandoff,
  QUICK_HANDOFF_KEY,
  QUICK_HANDOFF_TTL_MS,
  readQuickPlanHandoff,
  writeQuickPlanHandoff,
} from './handoff';

describe('landing handoff', () => {
  it('keeps financial data out of the navigation URL', () => {
    const storage = new MemoryStorage();
    const input = createLifePlanInput({ monthlyIncome: 23_456 });
    writeQuickPlanHandoff(input, storage, 1_000);

    const url = '/plans/new?from=quick';
    assert.equal(url.includes(String(input.monthlyIncome)), false);
    assert.equal(readQuickPlanHandoff(storage, 1_001).ok, true);
  });

  it('expires temporary handoffs and clears them explicitly', () => {
    const storage = new MemoryStorage();
    writeQuickPlanHandoff(createLifePlanInput(), storage, 1_000);

    assert.deepEqual(
      readQuickPlanHandoff(storage, 1_000 + QUICK_HANDOFF_TTL_MS),
      { ok: false, reason: 'expired' }
    );
    clearQuickPlanHandoff(storage);
    assert.equal(storage.getItem(QUICK_HANDOFF_KEY), null);
  });
});

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}
