import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { calculateMonthlyLifePlan } from '../calculation';
import { validateLifePlan } from '../domain';
import {
  analysisFixtures,
  createHousingChildOverlapFixture,
  createLiquidityGapFixture,
  createPersonalBaselineFixture,
} from './fixtures';

describe('P2.1 deterministic analysis fixtures', () => {
  it('keeps every fixture valid and reproducible', () => {
    for (const fixture of analysisFixtures) {
      assert.equal(
        validateLifePlan(fixture.plan).valid,
        true,
        `${fixture.id} should be valid`
      );
      const first = calculateMonthlyLifePlan(fixture.plan);
      const second = calculateMonthlyLifePlan(fixture.plan);
      assert.equal(first.inputHash, second.inputHash);
      assert.deepEqual(first.summary, second.summary);
      assert.deepEqual(first.annual, second.annual);
    }
  });

  it('locks the personal baseline to one member and zero opening cash', () => {
    const plan = createPersonalBaselineFixture();
    assert.deepEqual(
      plan.members.map((member) => member.role),
      ['self']
    );
    assert.equal(plan.assets.length, 1);
    assert.equal(plan.assets[0].openingBalanceCents, 0);

    const working = plan.cashFlowBuckets.find((bucket) =>
      bucket.id.endsWith('working-expenses')
    )?.summary;
    const retirement = plan.cashFlowBuckets.find((bucket) =>
      bucket.id.endsWith('retirement-expenses')
    )?.summary;
    assert.equal(working?.amountCents, retirement?.amountCents);
    assert.equal(working?.endMonthExclusive, plan.retirementMonth);
    assert.equal(retirement?.startMonth, plan.retirementMonth);
  });

  it('locks housing and child starts inside a 24-month overlap window', () => {
    const plan = createHousingChildOverlapFixture();
    const housing = plan.standaloneCashFlows.find(
      (flow) => flow.category === 'housing'
    );
    const child = plan.standaloneCashFlows.find(
      (flow) => flow.category === 'child'
    );
    assert.ok(housing);
    assert.ok(child);
    assert.equal(child.startMonth - housing.startMonth, 6);
    assert.ok(Math.abs(child.startMonth - housing.startMonth) <= 24);
  });

  it('contains a month with negative cash and positive net worth', () => {
    const result = calculateMonthlyLifePlan(createLiquidityGapFixture());
    const liquidityGap = result.monthly.find(
      (row) => row.closingAvailableCents < 0 && row.netWorthCents > 0
    );

    assert.ok(liquidityGap);
    assert.equal(result.summary.hasAnyGap, true);
    assert.ok(result.summary.endingNetWorthCents > 0);
  });
});
