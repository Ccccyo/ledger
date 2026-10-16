import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { calculateMonthlyLifePlan } from '../calculation';
import {
  addMonths,
  basisPoints,
  createQuickLifePlan,
  monthParts,
  yuan,
  type InvestmentScenario,
} from '../domain';
import {
  calculateInvestmentRange,
  investmentRangeMarkers,
} from './investment-range';

function scenario(
  plan = createQuickLifePlan({ id: 'investment-range' })
): InvestmentScenario {
  plan.assets[0].kind = 'investment';
  plan.assets[0].openingBalanceCents = yuan(100_000);
  return {
    id: 'scenario-1',
    name: '长期投资',
    assetId: plan.assets[0].id,
    principalCents: yuan(100_000),
    riskLevel: 'medium',
    lowerAnnualReturnBps: basisPoints(-1000),
    upperAnnualReturnBps: basisPoints(1500),
    startMonth: plan.baseMonth,
    endMonthExclusive: addMonths(plan.baseMonth, 12),
  };
}

describe('investment display range', () => {
  it('changes only the display band and leaves the formal calculation unchanged', () => {
    const plan = createQuickLifePlan({
      id: 'investment-band',
      currentSavingsYuan: 300_000,
    });
    plan.assets[0].kind = 'investment';
    plan.assets[0].openingBalanceCents = yuan(100_000);
    plan.metadata.investmentScenarios = [scenario(plan)];
    const before = calculateMonthlyLifePlan({
      ...plan,
      metadata: { ...plan.metadata, investmentScenarios: [] },
    });
    const formal = calculateMonthlyLifePlan(plan);
    assert.equal(
      formal.summary.endingAvailableCents,
      before.summary.endingAvailableCents
    );
    assert.equal(formal.summary.firstGapMonth, before.summary.firstGapMonth);
    const range = calculateInvestmentRange(formal);
    assert.equal(range.length, formal.annual.length);
    assert.ok(range.some((row) => row.lowerCents < row.principalCents));
    assert.ok(range.some((row) => row.upperCents > row.principalCents));
  });

  it('has no spread before the start and freezes the spread after the end', () => {
    const plan = createQuickLifePlan({ id: 'investment-window' });
    plan.assets[0].kind = 'investment';
    plan.assets[0].openingBalanceCents = yuan(100_000);
    const item = scenario(plan);
    item.startMonth = addMonths(plan.baseMonth, 12);
    item.endMonthExclusive = addMonths(plan.baseMonth, 24);
    plan.metadata.investmentScenarios = [item];
    const range = calculateInvestmentRange(calculateMonthlyLifePlan(plan));
    assert.equal(range[0].started, false);
    assert.equal(range[0].lowerCents, range[0].principalCents);
    assert.equal(range[0].upperCents, range[0].principalCents);
    assert.equal(range[1].started, true);
    const endSpread = range[1].upperCents - range[1].principalCents;
    assert.ok(endSpread > 0);
    assert.equal(range[2].upperCents - range[2].principalCents, endSpread);
  });

  it('adds multiple investment deltas without adding their principal twice', () => {
    const plan = createQuickLifePlan({ id: 'investment-multiple' });
    plan.assets[0].kind = 'investment';
    plan.assets[0].openingBalanceCents = yuan(100_000);
    const first = scenario(plan);
    const second = {
      ...scenario(plan),
      id: 'scenario-2',
      assetId: 'investment-2',
      principalCents: yuan(50_000),
      lowerAnnualReturnBps: basisPoints(0),
      upperAnnualReturnBps: basisPoints(1000),
    };
    plan.assets.push({
      ...plan.assets[0],
      id: 'investment-2',
      openingBalanceCents: yuan(50_000),
    });
    plan.metadata.investmentScenarios = [first, second];
    const formal = calculateMonthlyLifePlan(plan);
    const firstYear = calculateInvestmentRange(formal)[0];
    assert.equal(
      firstYear.principalCents,
      formal.annual[0].closingAvailableCents
    );
    assert.ok(firstYear.upperCents > firstYear.principalCents);
  });

  it('returns grouped start and stop nodes for the chart', () => {
    const plan = createQuickLifePlan({ id: 'investment-markers' });
    const item = scenario(plan);
    item.name = '长期投资';
    item.startMonth = addMonths(plan.baseMonth, 12);
    item.endMonthExclusive = addMonths(plan.baseMonth, 30);
    plan.metadata.investmentScenarios = [item];
    const markers = investmentRangeMarkers(calculateMonthlyLifePlan(plan));
    const baseYear = monthParts(plan.baseMonth).year;
    assert.deepEqual(markers, [
      {
        year: baseYear + 1,
        kind: 'start',
        names: ['长期投资'],
        ids: ['scenario-1'],
      },
      {
        year: baseYear + 2,
        kind: 'end',
        names: ['长期投资'],
        ids: ['scenario-1'],
      },
    ]);
  });
});
