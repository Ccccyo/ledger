import assert from 'node:assert/strict';
import { it } from 'node:test';

import { calculateMonthlyLifePlan } from '../calculation';
import {
  addMonths,
  basisPoints,
  createQuickLifePlan,
  yuan,
} from '../domain';
import {
  availableInvestmentPrincipalCents,
  removeInvestmentScenario,
  saveInvestmentScenario,
} from './plan/investment-mutations';

const baseline = () =>
  createQuickLifePlan({
    monthlyIncomeYuan: 0,
    monthlyWorkingExpensesYuan: 0,
    monthlyRetirementSelfFundedYuan: 0,
    currentSavingsYuan: 1_000_000,
  });

function input(plan: ReturnType<typeof baseline>, principalYuan = 300_000) {
  return {
    id: 'investment-one',
    name: '长期投资',
    principalYuan,
    riskLevel: 'medium' as const,
    lowerAnnualPercent: -10,
    upperAnnualPercent: 15,
    startMonth: plan.baseMonth,
    endMonthExclusive: addMonths(plan.baseMonth, 120),
  };
}

it('records a display-only allocation without moving or duplicating formal assets', () => {
  const plan = baseline();
  const before = calculateMonthlyLifePlan(plan);
  const next = saveInvestmentScenario(plan, input(plan));
  const after = calculateMonthlyLifePlan(next);

  assert.deepEqual(next.assets, plan.assets);
  assert.equal(next.metadata.investmentScenarios?.[0].assetId, undefined);
  assert.equal(
    after.monthly[0].openingAvailableCents,
    before.monthly[0].openingAvailableCents
  );
  assert.equal(
    after.summary.endingAvailableCents,
    before.summary.endingAvailableCents
  );
});

it('editing and removing an allocation never changes formal assets', () => {
  const plan = baseline();
  const saved = saveInvestmentScenario(plan, input(plan));
  const edited = saveInvestmentScenario(saved, input(saved, 450_000));
  assert.deepEqual(edited.assets, plan.assets);

  const removed = removeInvestmentScenario(edited, 'investment-one');
  assert.equal(removed.metadata.investmentScenarios?.length, 0);
  assert.deepEqual(removed.assets, plan.assets);
});

it('uses projected available principal at the investment start month', () => {
  const plan = createQuickLifePlan({
    monthlyIncomeYuan: 10_000,
    monthlyWorkingExpensesYuan: 0,
    monthlyRetirementSelfFundedYuan: 0,
    currentSavingsYuan: 0,
  });
  const future = {
    ...input(plan, 100_000),
    startMonth: addMonths(plan.baseMonth, 12),
    endMonthExclusive: addMonths(plan.baseMonth, 24),
  };
  assert.equal(
    availableInvestmentPrincipalCents(plan, future.startMonth),
    yuan(120_000)
  );
  assert.doesNotThrow(() => saveInvestmentScenario(plan, future));
  assert.throws(() =>
    saveInvestmentScenario(plan, { ...future, principalYuan: 120_001 })
  );
});

it('still rejects an allocation larger than projected available principal', () => {
  const plan = baseline();
  assert.throws(() => saveInvestmentScenario(plan, input(plan, 1_000_001)));
});

it('migrates an old linked investment asset back to cash when edited', () => {
  const plan = baseline();
  plan.assets[0].openingBalanceCents = yuan(700_000);
  plan.assets.push({
    ...plan.assets[0],
    id: 'legacy-investment',
    kind: 'investment',
    name: '旧投资',
    openingBalanceCents: yuan(300_000),
  });
  plan.metadata.investmentScenarios = [
    {
      id: 'investment-one',
      name: '旧投资',
      assetId: 'legacy-investment',
      principalCents: yuan(300_000),
      riskLevel: 'medium',
      lowerAnnualReturnBps: basisPoints(-1000),
      upperAnnualReturnBps: basisPoints(1500),
      startMonth: plan.baseMonth,
      endMonthExclusive: addMonths(plan.baseMonth, 120),
    },
  ];
  const migrated = saveInvestmentScenario(plan, input(plan, 400_000));
  assert.equal(migrated.assets.length, 1);
  assert.equal(migrated.assets[0].openingBalanceCents, yuan(1_000_000));
  assert.equal(migrated.metadata.investmentScenarios?.[0].assetId, undefined);
});
