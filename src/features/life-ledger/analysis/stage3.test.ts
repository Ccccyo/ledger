import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { calculateMonthlyLifePlan } from '../calculation';
import { addMonths, validateLifePlan, yuan } from '../domain';
import { createPlanBackup, parsePlanBackup } from '../storage/backup';
import { saveStageEvent } from '../workspace/plan/event-mutations';
import {
  confirmDetailedTotal,
  updateAges,
  updateCategoryDetail,
} from '../workspace/plan/plan-mutations';
import { PLAN_SECTIONS, resolvePlanSection } from '../workspace/plan/types';
import {
  initialWorkspaceState,
  workspaceReducer,
} from '../workspace/workspace-reducer';
import { annualChartData } from './chart-data';
import { compareResults } from './digest-result';
import { extractLifeTrajectory } from './extract-life-trajectory';
import {
  createHousingChildOverlapFixture,
  createLiquidityGapFixture,
  createPersonalBaselineFixture,
} from './fixtures';

describe('Stage 3 life planning', () => {
  it('derives seven ordered stages and real starting months from existing plans', () => {
    const plan = createHousingChildOverlapFixture();
    const nodes = extractLifeTrajectory(plan);
    assert.deepEqual(
      nodes.map((n) => n.stage),
      ['now', 'career', 'partner', 'child', 'parents', 'housing', 'retirement']
    );
    assert.equal(nodes[1].status, 'missing');
    assert.equal(nodes[3].month, addMonths(plan.baseMonth, 30));
    assert.equal(nodes[5].age, 32);
    assert.equal(nodes[6].month, plan.retirementMonth);
    assert.equal(
      extractLifeTrajectory(createLiquidityGapFixture())[5].status,
      'complete'
    );
  });
  it('keeps exclusions through backup and restores them without changing money', () => {
    const plan = createPersonalBaselineFixture();
    plan.metadata.excludedLifeStages = ['partner', 'child'];
    const restored = parsePlanBackup(
      JSON.stringify(createPlanBackup(plan))
    ).plan;
    assert.equal(extractLifeTrajectory(restored)[2].status, 'not-applicable');
    assert.equal(validateLifePlan(restored).valid, true);
    const added = saveStageEvent(restored, 'partner', {
      id: 'partner-contribution',
      name: 'Contribution',
      amountYuan: 1000,
      start: restored.baseMonth,
      end: restored.retirementMonth,
      frequency: 'monthly',
      direction: 'income',
    });
    assert.equal(extractLifeTrajectory(added)[2].status, 'complete');
    assert.equal(extractLifeTrajectory(added)[3].status, 'not-applicable');
    assert.equal(added.members.filter((m) => m.role === 'partner').length, 1);
    const edited = saveStageEvent(added, 'partner', {
      id: 'partner-contribution',
      name: 'Contribution',
      amountYuan: 2000,
      start: restored.baseMonth,
      end: restored.retirementMonth,
      frequency: 'monthly',
      direction: 'income',
    });
    assert.equal(edited.standaloneCashFlows.length, 1);
    assert.equal(edited.members.filter((m) => m.role === 'partner').length, 1);
    const invalid = structuredClone(plan);
    (invalid.metadata as any).excludedLifeStages = ['unknown'];
    assert.equal(validateLifePlan(invalid).valid, false);
  });
  it('adds monthly and one-time expenses only within selected months', () => {
    const plan = createPersonalBaselineFixture();
    const before = calculateMonthlyLifePlan(plan);
    const withChild = saveStageEvent(plan, 'child', {
      id: 'child',
      name: 'Child costs',
      amountYuan: 1000,
      start: addMonths(plan.baseMonth, 2),
      end: addMonths(plan.baseMonth, 5),
      frequency: 'monthly',
      direction: 'expense',
    });
    const withHousing = saveStageEvent(withChild, 'housing', {
      id: 'house',
      name: 'Deposit',
      amountYuan: 20_000,
      start: addMonths(plan.baseMonth, 3),
      end: plan.endMonthExclusive,
      frequency: 'once',
      direction: 'expense',
    });
    const after = calculateMonthlyLifePlan(withHousing);
    assert.deepEqual(
      after.monthly
        .slice(0, 6)
        .map((r, i) => r.expenseCents - before.monthly[i].expenseCents),
      [0, 0, yuan(1000), yuan(21000), yuan(1000), 0]
    );
    assert.equal(compareResults(before, after).endingDeltaCents, yuan(-23000));
    assert.equal(plan.standaloneCashFlows.length, 0);
    assert.throws(() =>
      saveStageEvent(plan, 'child', {
        id: 'bad',
        name: 'Bad',
        amountYuan: 10,
        start: plan.endMonthExclusive,
        end: plan.endMonthExclusive,
        frequency: 'once',
        direction: 'expense',
      })
    );
  });
  it('classification does not add expenses and exceeding a total requires confirmation', () => {
    const plan = createPersonalBaselineFixture();
    const classified = updateCategoryDetail(plan, 'housing', yuan(2000));
    assert.deepEqual(
      calculateMonthlyLifePlan(classified).monthly.map(
        (r) => r.closingAvailableCents
      ),
      calculateMonthlyLifePlan(plan).monthly.map((r) => r.closingAvailableCents)
    );
    const excessive = updateCategoryDetail(classified, 'child', yuan(8000));
    assert.equal(validateLifePlan(excessive).valid, false);
    assert.equal(validateLifePlan(confirmDetailedTotal(excessive)).valid, true);
  });
  it('breaks personal spending out of the landing total without counting it twice', () => {
    const plan = createPersonalBaselineFixture();
    const withTravel = updateCategoryDetail(
      plan,
      'self_travel',
      yuan(1000),
      '旅行储备'
    );
    const withPersonalSpending = updateCategoryDetail(
      withTravel,
      'self_learning',
      yuan(500),
      '学习成长'
    );
    const before = calculateMonthlyLifePlan(plan);
    const after = calculateMonthlyLifePlan(withPersonalSpending);

    assert.deepEqual(
      after.monthly.map((row) => row.expenseCents),
      before.monthly.map((row) => row.expenseCents)
    );
    assert.equal(after.monthly[0].expenseByCategory.self_travel, yuan(1000));
    assert.equal(after.monthly[0].expenseByCategory.self_learning, yuan(500));
    assert.doesNotThrow(() => annualChartData(after));
  });
  it('requires a fresh confirmation when an over-total detail changes', () => {
    const plan = createPersonalBaselineFixture();
    const excessive = updateCategoryDetail(
      plan,
      'self_travel',
      yuan(20_000),
      '旅行储备'
    );
    const confirmed = confirmDetailedTotal(excessive);
    assert.equal(validateLifePlan(confirmed).valid, true);
    const confirmedBucket = confirmed.cashFlowBuckets.find((bucket) =>
      bucket.id.endsWith('working-expenses')
    );
    assert.equal(confirmedBucket?.summary?.amountCents, yuan(20_000));
    assert.equal(confirmedBucket?.confirmedDetailedTotalCents, undefined);

    const edited = updateCategoryDetail(
      confirmed,
      'self_travel',
      yuan(21_000),
      '旅行储备'
    );
    assert.equal(validateLifePlan(edited).valid, false);
    assert.equal(validateLifePlan(confirmDetailedTotal(edited)).valid, true);
  });
  it('keeps independently dated events when changing retirement', () => {
    const plan = createHousingChildOverlapFixture();
    const next = updateAges(plan, 30, 65, 95);
    assert.equal(validateLifePlan(next).valid, true);
    assert.deepEqual(next.standaloneCashFlows, plan.standaloneCashFlows);
  });
  it('keeps editing sequential and compares against the last valid calculation', () => {
    const plan = createPersonalBaselineFixture();
    const result = calculateMonthlyLifePlan(plan);
    let state = { ...initialWorkspaceState, plan, result };
    state = workspaceReducer(state, {
      type: 'plan/edit',
      updater: (p) => ({ ...p, name: 'renamed' }),
    }) as typeof state;
    state = workspaceReducer(state, {
      type: 'plan/edit',
      updater: (p) => ({
        ...p,
        assets: p.assets.map((a) => ({
          ...a,
          openingBalanceCents: yuan(10000),
        })),
      }),
    }) as typeof state;
    assert.equal(state.plan.name, 'renamed');
    assert.equal(state.pendingChange, true);
    state = workspaceReducer(state, {
      type: 'calculation/failure',
      message: 'failed',
    }) as typeof state;
    assert.equal(state.result, result);
    const updated = calculateMonthlyLifePlan(state.plan);
    const successful = workspaceReducer(state, {
      type: 'calculation/success',
      result: updated,
    });
    assert.equal(successful.resultChange?.endingDeltaCents, yuan(10000));
    assert.equal(successful.pendingChange, false);
    const again = workspaceReducer(successful, {
      type: 'calculation/success',
      result: updated,
    });
    assert.deepEqual(again.resultChange, successful.resultChange);
  });
  it('routes old family links to children and exposes thirteen editors', () => {
    assert.equal(resolvePlanSection('family'), 'child');
    assert.equal(resolvePlanSection('partner-child'), 'child');
    assert.equal(resolvePlanSection('unknown'), 'basics');
    assert.equal(PLAN_SECTIONS.length, 13);
  });
});
