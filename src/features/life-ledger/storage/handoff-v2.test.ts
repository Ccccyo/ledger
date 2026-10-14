import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createQuickLifePlan } from '../domain';
import { MemoryStorage } from '../testing/memory-storage';
import {
  clearQuickPlanHandoffV2,
  QUICK_HANDOFF_V2_KEY,
  QUICK_HANDOFF_V2_TTL_MS,
  readQuickPlanHandoffV2,
  writeQuickPlanHandoffV2,
} from './handoff-v2';

describe('P2 landing handoff', () => {
  it('stores a validated plan without putting financial data in the URL', () => {
    const storage = new MemoryStorage();
    const plan = createQuickLifePlan({ monthlyIncomeYuan: 23_456 });

    writeQuickPlanHandoffV2(plan, 'input-hash', storage, 1_000);

    assert.equal('/plan'.includes('23456'), false);
    const result = readQuickPlanHandoffV2(storage, 1_001);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.handoff.plan.id, plan.id);
      assert.equal(result.handoff.inputHash, 'input-hash');
      assert.equal(result.handoff.createdAt, 1_000);
      assert.equal(result.handoff.expiresAt, 1_000 + QUICK_HANDOFF_V2_TTL_MS);
    }
  });

  it('reports a missing envelope without mutating storage', () => {
    const storage = new MemoryStorage();
    assert.deepEqual(readQuickPlanHandoffV2(storage, 1_000), {
      ok: false,
      reason: 'missing',
    });
    assert.equal(storage.length, 0);
  });

  it('rejects expired, unsupported and corrupt envelopes', () => {
    const storage = new MemoryStorage();
    writeQuickPlanHandoffV2(
      createQuickLifePlan(),
      'input-hash',
      storage,
      1_000
    );
    assert.deepEqual(
      readQuickPlanHandoffV2(storage, 1_000 + QUICK_HANDOFF_V2_TTL_MS),
      { ok: false, reason: 'expired' }
    );

    storage.setItem(
      QUICK_HANDOFF_V2_KEY,
      JSON.stringify({ envelopeVersion: '3.0.0' })
    );
    assert.deepEqual(readQuickPlanHandoffV2(storage), {
      ok: false,
      reason: 'unsupported-version',
    });

    storage.setItem(QUICK_HANDOFF_V2_KEY, '{broken');
    assert.deepEqual(readQuickPlanHandoffV2(storage), {
      ok: false,
      reason: 'corrupt',
    });
  });

  it('clears the envelope only when asked', () => {
    const storage = new MemoryStorage();
    writeQuickPlanHandoffV2(createQuickLifePlan(), 'input-hash', storage);
    assert.equal(readQuickPlanHandoffV2(storage).ok, true);
    assert.notEqual(storage.getItem(QUICK_HANDOFF_V2_KEY), null);
    clearQuickPlanHandoffV2(storage);
    assert.equal(storage.getItem(QUICK_HANDOFF_V2_KEY), null);
  });

  it('rejects invalid plans and empty hashes before writing', () => {
    const storage = new MemoryStorage();
    const invalidPlan = {
      ...createQuickLifePlan(),
      retirementMonth: createQuickLifePlan().baseMonth,
    };

    assert.throws(
      () => writeQuickPlanHandoffV2(invalidPlan, 'hash', storage),
      /invalid life plan/
    );
    assert.throws(
      () => writeQuickPlanHandoffV2(createQuickLifePlan(), '', storage),
      /invalid life plan/
    );
    assert.equal(storage.getItem(QUICK_HANDOFF_V2_KEY), null);
  });
});
