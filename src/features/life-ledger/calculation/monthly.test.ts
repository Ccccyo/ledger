import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createQuickLifePlan,
  monthParts,
  validateLifePlan,
  type MoneyCents,
} from '../domain';
import { GOLDEN_CASES } from './golden-fixtures';
import {
  calculateMonthlyLifePlan,
  safeCalculateMonthlyLifePlan,
} from './monthly';

describe('P1 monthly calculation core', () => {
  it('passes the manually specified golden cases', () => {
    for (const fixture of GOLDEN_CASES) {
      const validation = validateLifePlan(fixture.plan);
      assert.equal(
        validation.valid,
        true,
        `${fixture.name}: ${JSON.stringify(validation.issues)}`
      );
      const result = calculateMonthlyLifePlan(fixture.plan);
      assert.equal(
        result.summary.endingAvailableCents,
        fixture.expected.endingAvailableCents,
        fixture.name
      );
      assert.equal(
        result.summary.endingDebtCents,
        fixture.expected.endingDebtCents,
        fixture.name
      );
      assert.equal(
        result.summary.endingNetWorthCents,
        fixture.expected.endingNetWorthCents,
        fixture.name
      );
      assert.equal(
        result.summary.firstGapMonth,
        fixture.expected.firstGapMonth,
        fixture.name
      );
    }
  });

  it('derives annual rows only by aggregating monthly rows', () => {
    const result = calculateMonthlyLifePlan(
      createQuickLifePlan({ id: 'annual' })
    );
    for (const annual of result.annual) {
      const months = result.monthly.filter((row) => row.year === annual.year);
      assert.equal(
        annual.incomeCents,
        months.reduce((sum, row) => sum + row.incomeCents, 0)
      );
      assert.equal(
        annual.expenseCents,
        months.reduce((sum, row) => sum + row.expenseCents, 0)
      );
      assert.equal(
        annual.closingAvailableCents,
        months.at(-1)?.closingAvailableCents
      );
    }
  });

  it('keeps cash, debt and non-liquid property separate', () => {
    const fixture = GOLDEN_CASES.find((value) => value.name === '已有住房')!;
    const result = calculateMonthlyLifePlan(fixture.plan);
    assert.equal(result.summary.endingAvailableCents, 0);
    assert.equal(result.summary.endingDebtCents, 0);
    assert.equal(result.summary.endingNetWorthCents, 100_000_000);
  });

  it('reports endpoint solvency and no-monthly-gap income separately', () => {
    const fixture = GOLDEN_CASES.find(
      (value) => value.name === '最终有结余但中途缺钱'
    )!;
    const result = calculateMonthlyLifePlan(fixture.plan);
    assert.equal(result.summary.requiredIncome.endpointZeroSupplementCents, 0);
    assert.ok(result.summary.requiredIncome.noGapSupplementCents > 0);
  });

  it('conserves each monthly cash balance', () => {
    const result = calculateMonthlyLifePlan(
      createQuickLifePlan({ id: 'conservation' })
    );
    result.monthly.forEach((row) => {
      assert.equal(
        row.closingAvailableCents,
        row.openingAvailableCents +
          row.liquidReturnCents +
          row.incomeCents -
          row.expenseCents -
          row.investmentAllocatedCents +
          row.investmentReleasedCents
      );
      assert.equal(row.netCashFlowCents, row.incomeCents - row.expenseCents);
    });
  });

  it('returns no partial ledger for invalid input', () => {
    const plan = createQuickLifePlan({ id: 'invalid' });
    plan.cashFlowBuckets[0].summary!.amountCents = 1.5 as unknown as MoneyCents;
    const result = safeCalculateMonthlyLifePlan(plan);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error.code, 'INVALID_PLAN');
  });

  it('is deterministic, finite and does not mutate inputs', () => {
    const random = mulberry32(20261013);
    for (let index = 0; index < 50; index += 1) {
      const currentAge = integer(random, 18, 50);
      const retirementAge = integer(random, currentAge + 1, 70);
      const endAge = integer(random, retirementAge + 1, 100);
      const plan = createQuickLifePlan({
        id: `random-${index}`,
        baseYear: integer(random, 2020, 2040),
        currentAge,
        retirementAge,
        endAge,
        monthlyIncomeYuan: integer(random, 0, 100_000),
        monthlyWorkingExpensesYuan: integer(random, 0, 50_000),
        monthlyRetirementSelfFundedYuan: integer(random, 0, 50_000),
        currentSavingsYuan: integer(random, 0, 10_000_000),
      });
      const snapshot = structuredClone(plan);
      const first = calculateMonthlyLifePlan(plan);
      const second = calculateMonthlyLifePlan(structuredClone(plan));
      assert.deepEqual(plan, snapshot, `input mutation case=${index}`);
      assert.deepEqual(second, first, `determinism case=${index}`);
      assert.ok(
        first.monthly.every((row) =>
          [
            row.closingAvailableCents,
            row.debtBalanceCents,
            row.netWorthCents,
          ].every(Number.isFinite)
        ),
        `finite case=${index}`
      );
      assert.equal(first.monthly.length, (endAge - currentAge) * 12);
      assert.equal(
        monthParts(first.monthly[0].month).year,
        plan.versions ? monthParts(plan.baseMonth).year : 0
      );
    }
  });
});

function integer(random: () => number, minimum: number, maximum: number) {
  return Math.floor(random() * (maximum - minimum + 1)) + minimum;
}

function mulberry32(seed: number) {
  return () => {
    let value = (seed += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}
