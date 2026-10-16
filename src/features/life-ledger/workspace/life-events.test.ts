import assert from 'node:assert/strict';
import { it } from 'node:test';

import { lifeStageExpenses } from '../analysis/life-stage-expenses';
import { lifeTimeline, primaryTimelineEvents } from '../analysis/life-timeline';
import { calculateMonthlyLifePlan } from '../calculation';
import {
  addMonths,
  createQuickLifePlan,
  validateLifePlan,
  yuan,
} from '../domain';
import { createPlanBackup, parsePlanBackup } from '../storage/backup';
import { saveStageEvent } from './plan/event-mutations';
import {
  estimateMortgage,
  removePurchase,
  savePurchase,
} from './plan/housing-mutations';
import { updateRetirementPension } from './plan/plan-mutations';

const baseline = () =>
  createQuickLifePlan({
    monthlyIncomeYuan: 0,
    monthlyWorkingExpensesYuan: 0,
    monthlyRetirementSelfFundedYuan: 0,
    currentSavingsYuan: 1_000_000,
  });

it('counts a user-entered pension as retirement income without reducing retirement spending', () => {
  const plan = updateRetirementPension(baseline(), yuan(5000));
  const result = calculateMonthlyLifePlan(plan);
  const retirement = result.monthly.find(
    (row) => row.month === plan.retirementMonth
  )!;
  assert.equal(retirement.incomeByCategory.pension, yuan(5000));
  assert.equal(retirement.expenseByCategory.retirement ?? 0, 0);
  assert.equal(validateLifePlan(plan).valid, true);
});
it('multiple child and custom events coexist, yearly school fees post only in their selected month', () => {
  let p = baseline();
  for (const [id, stage, frequency, amount] of [
    ['birth', 'child', 'once', 10000],
    ['school', 'child', 'yearly', 20000],
    ['travel', 'events', 'yearly', 3000],
    ['car', 'events', 'once', 50000],
  ] as const)
    p = saveStageEvent(p, stage, {
      id,
      name: id,
      frequency,
      amountYuan: amount,
      start: addMonths(p.baseMonth, 2),
      end: addMonths(p.baseMonth, 26),
      direction: 'expense',
    });
  const r = calculateMonthlyLifePlan(p);
  assert.equal(p.standaloneCashFlows.length, 4);
  assert.equal(r.monthly[2].expenseCents, yuan(83000));
  assert.equal(r.monthly[3].expenseCents, 0);
  assert.equal(r.monthly[14].expenseCents, yuan(23000));
  assert.equal(r.monthly[26].expenseCents, 0);
  assert.deepEqual(
    parsePlanBackup(JSON.stringify(createPlanBackup(p))).plan,
    JSON.parse(JSON.stringify(p))
  );
});
it('family, parents and housing support are bidirectional without merging amounts', () => {
  let p = baseline();
  for (const stage of ['partner', 'parents', 'housing'] as const)
    for (const direction of ['income', 'expense'] as const)
      p = saveStageEvent(p, stage, {
        id: stage + direction,
        name: stage + direction,
        frequency: 'monthly',
        amountYuan: direction === 'income' ? 3000 : 1000,
        start: p.baseMonth,
        end: addMonths(p.baseMonth, 12),
        direction,
      });
  const r = calculateMonthlyLifePlan(p);
  assert.equal(r.monthly[0].incomeCents, yuan(9000));
  assert.equal(r.monthly[0].expenseCents, yuan(3000));
});
it('future purchase enters assets and debt only at purchase; down payment and repayment counted once', () => {
  const p = baseline(),
    month = addMonths(p.baseMonth, 12);
  const input = {
    id: 'home',
    name: 'Home',
    priceYuan: 600000,
    downPaymentYuan: 480000,
    annualRatePercent: 0,
    years: 1,
    month,
  };
  const next = savePurchase(p, input),
    r = calculateMonthlyLifePlan(next);
  assert.equal(validateLifePlan(next).valid, true);
  assert.equal(r.monthly[11].nonLiquidAssetsCents, 0);
  assert.equal(r.monthly[11].debtBalanceCents, 0);
  assert.equal(r.monthly[12].incomeCents, 0);
  assert.equal(r.monthly[12].expenseCents, yuan(490000));
  assert.equal(r.monthly[12].openingAvailableCents, yuan(1000000));
  assert.equal(r.monthly[12].closingAvailableCents, yuan(510000));
  assert.equal(r.monthly[12].nonLiquidAssetsCents, yuan(600000));
  assert.equal(r.monthly[12].debtBalanceCents, yuan(110000));
  assert.equal(r.monthly[12].netWorthCents, yuan(1000000));
  assert.equal(r.monthly[23].debtBalanceCents, 0);
  assert.equal(r.monthly[24].expenseCents, 0);
  assert.equal(
    savePurchase(next, { ...input, priceYuan: 700000 }).assets.length,
    next.assets.length
  );
  assert.deepEqual(removePurchase(next, 'home').assets, p.assets);
  assert.equal(removePurchase(next, 'home').standaloneCashFlows.length, 0);
  assert.deepEqual(
    parsePlanBackup(JSON.stringify(createPlanBackup(next))).plan,
    JSON.parse(JSON.stringify(next))
  );
});
it('quoted-rate mortgage matches calculator totals and last payment; all-cash purchase creates no debt', () => {
  const p = baseline(),
    input = {
      id: 'home',
      name: 'Home',
      priceYuan: 1000000,
      downPaymentYuan: 300000,
      annualRatePercent: 3.5,
      years: 30,
      month: p.baseMonth,
    };
  const e = estimateMortgage(
    input.priceYuan,
    input.downPaymentYuan,
    input.annualRatePercent,
    input.years
  );
  assert.equal(e.payment, 314332);
  const r = calculateMonthlyLifePlan(savePurchase(p, input));
  assert.equal(r.monthly[359].debtBalanceCents, 0);
  assert.equal(
    r.monthly.slice(0, 360).reduce((sum, row) => sum + row.expenseCents, 0),
    yuan(1000000) + e.interest
  );
  const cash = savePurchase(p, { ...input, downPaymentYuan: 1000000 });
  assert.equal(cash.liabilities.length, 0);
  assert.equal(
    calculateMonthlyLifePlan(cash).monthly[0].netWorthCents,
    yuan(1000000)
  );
  assert.throws(() => estimateMortgage(100, 101, 3, 30));
  assert.throws(() => estimateMortgage(100, 0, 3, 1.2));
});
it('timeline sorts all independently named events and loan final month; no invented pension dates', () => {
  let p = baseline();
  p = savePurchase(p, {
    id: 'home',
    name: 'Home',
    priceYuan: 100000,
    downPaymentYuan: 20000,
    annualRatePercent: 0,
    years: 1,
    month: addMonths(p.baseMonth, 3),
  });
  p = saveStageEvent(p, 'child', {
    id: 'child',
    name: 'School',
    amountYuan: 3000,
    start: addMonths(p.baseMonth, 1),
    end: addMonths(p.baseMonth, 30),
    frequency: 'yearly',
    direction: 'expense',
  });
  const list = lifeTimeline(p);
  assert.equal(
    list.filter((e) => e.name === 'Home' && e.kind === 'event').length,
    1
  );
  assert.equal(
    list.find((e) => e.kind === 'loan_end')?.month,
    addMonths(p.baseMonth, 14)
  );
  assert.ok(list.every((e, i) => !i || e.month >= list[i - 1].month));
});

it('main timeline keeps only major life events and displays them chronologically', () => {
  let p = baseline();
  p = saveStageEvent(p, 'parents', {
    id: 'support',
    name: 'Monthly support',
    amountYuan: 1000,
    start: addMonths(p.baseMonth, 1),
    end: addMonths(p.baseMonth, 30),
    frequency: 'monthly',
    direction: 'expense',
  });
  p = saveStageEvent(p, 'child', {
    id: 'birth',
    name: 'First child',
    amountYuan: 30000,
    start: addMonths(p.baseMonth, 18),
    end: p.endMonthExclusive,
    frequency: 'once',
    direction: 'expense',
  });
  p = savePurchase(p, {
    id: 'home-two',
    name: 'First home',
    priceYuan: 100000,
    downPaymentYuan: 20000,
    annualRatePercent: 0,
    years: 1,
    month: addMonths(p.baseMonth, 6),
  });
  const primary = primaryTimelineEvents(p);
  assert.deepEqual(
    primary.map((event) => event.name),
    ['First home', 'First child', '']
  );
  assert.deepEqual(
    primary.map((event) => event.kind),
    ['event', 'event', 'retirement']
  );
  assert.ok(
    primary.every((event, i) => !i || event.month >= primary[i - 1].month)
  );
  assert.ok(!primary.some((event) => event.name === 'Monthly support'));
  assert.ok(!primary.some((event) => event.kind === 'loan_end'));
  const result = calculateMonthlyLifePlan(p);
  const stages = lifeStageExpenses(result);
  assert.deepEqual(
    stages.map((stage) => stage.event?.name ?? ''),
    ['', 'First home', 'First child', '']
  );
  assert.equal(
    stages.reduce((sum, stage) => sum + stage.months, 0),
    result.monthly.length
  );
  for (const stage of stages) {
    assert.equal(
      Object.values(stage.groups).reduce((sum, amount) => sum + amount, 0),
      stage.totalCents
    );
    assert.equal(
      stage.monthlyAverageCents,
      Math.round(stage.totalCents / stage.months)
    );
  }
});
