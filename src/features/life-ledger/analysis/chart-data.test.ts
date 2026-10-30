import assert from 'node:assert/strict';
import { it } from 'node:test';

import { calculateMonthlyLifePlan } from '../calculation';
import { annualChartData, EXPENSE_GROUPS, keyYears } from './chart-data';
import { analysisFixtures } from './fixtures';

it('chart groups conserve every cent and key years belong to the annual ledger', () => {
  for (const fixture of analysisFixtures) {
    const result = calculateMonthlyLifePlan(fixture.plan);
    const rows = annualChartData(result);
    rows.forEach((r, i) => {
      const months = result.monthly.filter((month) => month.year === r.year);
      assert.equal(
        EXPENSE_GROUPS.reduce((s, k) => s + r[k], 0),
        result.annual[i].expenseCents
      );
      assert.equal(
        r.expense,
        months.reduce((sum, month) => sum + month.expenseCents, 0)
      );
      assert.equal(
        r.income,
        months.reduce((sum, month) => sum + month.incomeCents, 0)
      );
      assert.equal(r.available, result.annual[i].closingAvailableCents);
      assert.equal(r.income, result.annual[i].incomeCents);
      assert.equal(r.netWorth, result.annual[i].closingNetWorthCents);
    });
    assert.ok(
      keyYears(result).every((y) => result.annual.some((r) => r.year === y))
    );
    if (result.summary.firstGapYear)
      assert.ok(keyYears(result).includes(result.summary.firstGapYear));
    const first = result.annual[0];
    assert.equal(first.ageStart, result.monthly[0].age);
  }
});
