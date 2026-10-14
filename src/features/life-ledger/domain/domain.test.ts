import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createQuickLifePlan,
  migrateLifePlan,
  resolveLifePlan,
  validateLifePlan,
  yuan,
} from './index';

describe('P0 life plan data standard', () => {
  it('uses a summary exactly once', () => {
    const plan = createQuickLifePlan({ id: 'summary' });
    const resolved = resolveLifePlan(plan);
    assert.equal(resolved.cashFlows.length, 3);
    assert.ok(
      resolved.cashFlows.every((flow) => flow.resolution === 'summary')
    );
  });

  it('replaces a summary with details and an unallocated remainder', () => {
    const plan = createQuickLifePlan({
      id: 'details',
      monthlyWorkingExpensesYuan: 7_000,
    });
    const bucket = plan.cashFlowBuckets.find((value) =>
      value.id.endsWith('working-expenses')
    )!;
    const summary = bucket.summary!;
    bucket.mode = 'detailed';
    bucket.details = [
      {
        ...summary,
        id: 'housing',
        name: '住房',
        category: 'housing',
        amountCents: yuan(2_000),
      },
      { ...summary, id: 'living', name: '生活', amountCents: yuan(3_000) },
    ];

    const resolved = resolveLifePlan(plan);
    const active = resolved.cashFlows.filter(
      (flow) => flow.bucketId === bucket.id
    );
    assert.deepEqual(
      active.map((flow) => flow.amountCents),
      [yuan(2_000), yuan(3_000), yuan(2_000)]
    );
    assert.ok(!active.some((flow) => flow.id === summary.id));
  });

  it('blocks an unconfirmed detailed total that exceeds its summary', () => {
    const plan = createQuickLifePlan({ id: 'over' });
    const bucket = plan.cashFlowBuckets[0];
    bucket.mode = 'detailed';
    bucket.details = [
      { ...bucket.summary!, id: 'large-detail', amountCents: yuan(99_999) },
    ];
    const validation = validateLifePlan(plan);
    assert.equal(validation.valid, false);
    assert.ok(
      validation.issues.some((value) => value.code === 'DETAILS_EXCEED_SUMMARY')
    );
  });

  it('allows the user to confirm a new detailed total', () => {
    const plan = createQuickLifePlan({ id: 'confirmed-over' });
    const bucket = plan.cashFlowBuckets[0];
    bucket.mode = 'detailed';
    bucket.details = [
      { ...bucket.summary!, id: 'large-detail', amountCents: yuan(99_999) },
    ];
    bucket.confirmedDetailedTotalCents = yuan(99_999);
    const resolved = resolveLifePlan(plan);
    assert.equal(
      resolved.cashFlows.filter((flow) => flow.bucketId === bucket.id).length,
      1
    );
  });

  it('does not calculate an unconfirmed Agent suggestion', () => {
    const plan = createQuickLifePlan({ id: 'agent' });
    plan.cashFlowBuckets[0].summary = {
      ...plan.cashFlowBuckets[0].summary!,
      source: { kind: 'agent', label: '规划 Agent' },
      confirmation: 'pending',
    };
    const validation = validateLifePlan(plan);
    assert.equal(validation.valid, false);
    assert.ok(
      validation.issues.some((value) => value.code === 'PENDING_AGENT_VALUE')
    );
  });

  it('migrates legacy quick-calculator data deterministically', () => {
    const legacy = {
      baseYear: 2026,
      currentAge: 28,
      retirementAge: 60,
      endAge: 90,
      monthlyIncome: 18_000,
      monthlyWorkingExpenses: 9_000,
      monthlyRetirementSelfFunded: 7_000,
      currentSavings: 200_000,
    };
    const context = { planId: 'migrated', now: '2026-10-13T00:00:00.000Z' };
    assert.deepEqual(
      migrateLifePlan(legacy, context),
      migrateLifePlan(structuredClone(legacy), context)
    );
  });
});
