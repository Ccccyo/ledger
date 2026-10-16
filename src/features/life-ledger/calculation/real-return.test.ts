import assert from 'node:assert/strict';
import { it } from 'node:test';

import { addMonths, basisPoints, createQuickLifePlan, yuan } from '../domain';
import { calculateMonthlyLifePlan } from './monthly';

for (const bps of [0, 1200, -1200]) {
  it(`keeps the formal ledger at principal value when the legacy liquid return is ${bps}bps`, () => {
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
    assert.ok(result.monthly.every((row) => row.liquidReturnCents === 0));
    assert.equal(result.summary.endingAvailableCents, yuan(10_000));
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

it('keeps non-liquid assets at principal value even when an old asset return is present', () => {
  const base = createQuickLifePlan({ id: 'asset-principal-only' });
  const property = {
    ...base.assets[0],
    id: 'property',
    kind: 'property' as const,
    liquid: false,
    openingBalanceCents: yuan(1_000_000),
    annualReturnBps: basisPoints(2000),
  };
  const result = calculateMonthlyLifePlan({
    ...base,
    assets: [property],
  });
  assert.ok(
    result.monthly.every((row) => row.nonLiquidAssetsCents === yuan(1_000_000))
  );
});
