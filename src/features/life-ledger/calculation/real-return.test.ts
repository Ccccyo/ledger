import assert from 'node:assert/strict';
import { it } from 'node:test';

import { addMonths, basisPoints, createQuickLifePlan, yuan } from '../domain';
import { calculateMonthlyLifePlan } from './monthly';

// Independent 12-month golden values: opening 10,000 yuan, no cash flows,
// effective annual return converted to monthly, rounding each month to cents.
for (const [bps, firstReturn, closing] of [
  [0, 0, 1000000],
  [1200, 9489, 1120001],
  [-1200, -10596, 879999],
]) {
  it(`real liquid return ${bps}bps compounds once in today's purchasing power`, () => {
    const base = createQuickLifePlan({
      id: `real-return-${bps}`,
      currentSavingsYuan: 10000,
      now: '2026-01-01T00:00:00.000Z',
    });
    const plan = {
      ...base,
      retirementMonth: addMonths(base.baseMonth, 6),
      endMonthExclusive: addMonths(base.baseMonth, 12),
      cashFlowBuckets: [],
      standaloneCashFlows: [],
      assumptions: {
        ...base.assumptions,
        annualLiquidReturnBps: basisPoints(bps),
      },
    };
    const result = calculateMonthlyLifePlan(plan);
    assert.equal(result.monthly.length, 12);
    assert.equal(result.monthly[0].liquidReturnCents, firstReturn);
    assert.equal(result.summary.endingAvailableCents, closing);
    assert.ok(
      result.monthly.every(
        (row) => row.incomeCents === 0 && row.expenseCents === 0
      )
    );
    assert.equal(result.input.assumptions.purchasingPower, 'today');
  });
}

it('negative available funds use the explicit gap cost, not the positive balance return', () => {
  const base = createQuickLifePlan({
    id: 'gap-return',
    currentSavingsYuan: 0,
    monthlyIncomeYuan: 0,
    monthlyWorkingExpensesYuan: 1000,
    now: '2026-01-01T00:00:00.000Z',
  });
  const result = calculateMonthlyLifePlan({
    ...base,
    assumptions: {
      ...base.assumptions,
      annualLiquidReturnBps: basisPoints(1200),
      annualCashGapCostBps: basisPoints(0),
    },
  });
  assert.equal(result.monthly[0].closingAvailableCents, -yuan(1000));
  // IEEE -0 is possible for a negative balance multiplied by zero; both mean no cost.
  assert.equal(Math.abs(result.monthly[1].liquidReturnCents), 0);
});
