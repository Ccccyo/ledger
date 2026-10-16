import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { lifeTimeline } from '../analysis/life-timeline';
import { calculateMonthlyLifePlan } from '../calculation';
import {
  addMonths,
  basisPoints,
  createQuickLifePlan,
  yuan,
  validateLifePlan,
  type CashFlowItem,
} from '../domain';
import {
  removeRelocation,
  saveRelocation,
  type RelocationInput,
} from './plan/relocation-mutations';

function baseline() {
  return createQuickLifePlan({
    id: 'relocation-plan',
    monthlyIncomeYuan: 0,
    monthlyWorkingExpensesYuan: 0,
    monthlyRetirementSelfFundedYuan: 0,
    currentSavingsYuan: 100_000,
  });
}

function input(
  plan: ReturnType<typeof baseline>,
  changes: Partial<RelocationInput> = {}
): RelocationInput {
  return {
    id: 'move-one',
    currentCity: '上海',
    targetCity: '杭州',
    moveMonth: addMonths(plan.baseMonth, 12),
    movingExpenseYuan: 0,
    housingMonthlyChangeYuan: 0,
    livingMonthlyChangeYuan: 0,
    incomeMonthlyChangeYuan: 0,
    flowNames: {
      moving: '搬迁费用',
      housing: '住房支出变化',
      living: '生活支出变化',
      income: '收入变化',
    },
    ...changes,
  };
}

describe('relocation planning', () => {
  it('stores city-only plans without changing any formal result', () => {
    const plan = baseline();
    const before = calculateMonthlyLifePlan(plan);
    const next = saveRelocation(plan, input(plan));
    const after = calculateMonthlyLifePlan(next);

    assert.equal(next.metadata.relocations?.length, 1);
    assert.equal(next.standaloneCashFlows.length, 0);
    assert.equal(after.summary.endingAvailableCents, before.summary.endingAvailableCents);
    assert.equal(validateLifePlan(next).valid, true);
  });

  it('maps each confirmed change to one existing cash-flow item', () => {
    const plan = baseline();
    const next = saveRelocation(
      plan,
      input(plan, {
        movingExpenseYuan: 10_000,
        housingMonthlyChangeYuan: -1_000,
        livingMonthlyChangeYuan: 500,
        incomeMonthlyChangeYuan: -2_000,
      })
    );
    const relocation = next.metadata.relocations?.[0];
    assert.ok(relocation);
    assert.equal(next.standaloneCashFlows.length, 4);
    assert.deepEqual(
      next.standaloneCashFlows.map((flow) => [
        flow.id,
        flow.direction,
        flow.category,
        flow.frequency.kind,
      ]),
      [
        [relocation.movingExpenseFlowId, 'expense', 'housing', 'once'],
        [relocation.housingAdjustmentFlowId, 'income', 'housing', 'monthly'],
        [relocation.livingAdjustmentFlowId, 'expense', 'living', 'monthly'],
        [relocation.incomeAdjustmentFlowId, 'expense', 'other', 'monthly'],
      ]
    );
    const result = calculateMonthlyLifePlan(next);
    assert.equal(result.monthly[12].incomeCents, yuan(1_000));
    assert.equal(result.monthly[12].expenseCents, yuan(12_500));
    assert.equal(result.monthly[13].incomeCents, yuan(1_000));
    assert.equal(result.monthly[13].expenseCents, yuan(2_500));

    const edited = saveRelocation(
      next,
      input(plan, {
        movingExpenseYuan: 8_000,
        housingMonthlyChangeYuan: -800,
        livingMonthlyChangeYuan: 300,
        incomeMonthlyChangeYuan: -1_000,
      })
    );
    assert.equal(edited.standaloneCashFlows.length, 4);
    assert.equal(edited.metadata.relocations?.length, 1);
    assert.equal(validateLifePlan(edited).valid, true);
  });

  it('rejects relocation metadata that points to a missing cash flow', () => {
    const plan = saveRelocation(baseline(), input(baseline()));
    plan.metadata.relocations![0].movingExpenseFlowId = 'missing-flow';
    const validation = validateLifePlan(plan);
    assert.equal(validation.valid, false);
    assert.ok(
      validation.issues.some((issue) => issue.code === 'INVALID_RELOCATION')
    );
  });

  it('removes only linked flows and adds a navigable city milestone', () => {
    const plan = baseline();
    const unrelated: CashFlowItem = {
      id: 'unrelated',
      name: '旅行',
      direction: 'expense',
      category: 'other',
      ownerId: plan.primaryMemberId,
      amountCents: yuan(1_000),
      frequency: { kind: 'once', postingMonth: plan.baseMonth },
      startMonth: plan.baseMonth,
      endMonthExclusive: addMonths(plan.baseMonth, 1),
      annualGrowthBps: basisPoints(0),
      source: { kind: 'user', label: '用户填写' },
      confirmation: 'confirmed',
    };
    plan.standaloneCashFlows.push(unrelated);
    const saved = saveRelocation(
      plan,
      input(plan, { movingExpenseYuan: 5_000 })
    );
    const marker = lifeTimeline(saved).find((event) => event.kind === 'relocation');
    assert.equal(marker?.name, '杭州');
    assert.equal(marker?.target, 'housing:relocation:move-one');

    const removed = removeRelocation(saved, 'move-one');
    assert.deepEqual(removed.standaloneCashFlows.map((flow) => flow.id), [
      'unrelated',
    ]);
    assert.equal(removed.metadata.relocations?.length, 0);
  });
});
