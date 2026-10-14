import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  calculateLifePlan,
  CALCULATION_VERSIONS,
  createLifePlanInput,
  safeCalculateLifePlan,
} from './index';

describe('life-ledger calculation core', () => {
  it('reproduces the published quick-estimate defaults', () => {
    const input = createLifePlanInput();
    const result = calculateLifePlan(input);

    assert.equal(result.summary.workingYears, 32);
    assert.equal(result.summary.retirementYears, 30);
    assert.equal(result.summary.projectedRetirementBalance, 3_656_000);
    assert.equal(result.summary.targetRetirementFund, 2_520_000);
    assert.equal(result.summary.retirementSurplusOrGap, 1_136_000);
    assert.equal(result.summary.minimumBalance, 200_000);
    assert.equal(Math.round(result.summary.requiredMonthlyIncome), 15_042);
    assert.deepEqual(result.versions, CALCULATION_VERSIONS);
  });

  it('produces one auditable row for every planned year', () => {
    const input = createLifePlanInput({
      baseYear: 2030,
      currentAge: 30,
      retirementAge: 60,
      endAge: 90,
    });
    const result = calculateLifePlan(input);

    assert.equal(result.annualCashFlow.length, 60);
    assert.deepEqual(
      result.annualCashFlow.map(({ age, year }) => [age, year]).slice(0, 2),
      [
        [30, 2030],
        [31, 2031],
      ]
    );
    assert.equal(result.annualCashFlow.at(-1)?.age, 89);
    assert.equal(result.annualCashFlow.at(-1)?.year, 2089);
  });

  it('keeps end balance and intermediate deficits as separate conclusions', () => {
    const input = createLifePlanInput({
      monthlyIncome: 0,
      monthlyWorkingExpenses: 1_000,
      monthlyRetirementSelfFunded: 0,
      currentSavings: 0,
    });
    const result = calculateLifePlan(input);

    assert.equal(result.summary.hasAnyDeficit, true);
    assert.equal(result.summary.firstDeficitAge, input.currentAge);
    assert.equal(result.summary.firstDeficitYear, input.baseYear);
    assert.ok(result.summary.minimumBalance < 0);
  });

  it('solves need mode without changing the input object', () => {
    const input = createLifePlanInput({ mode: 'need', monthlyIncome: 0 });
    const snapshot = structuredClone(input);
    const result = calculateLifePlan(input);

    assert.deepEqual(input, snapshot);
    assert.ok(Math.abs(result.summary.endingBalance) < 0.01);
    assert.ok(result.summary.requiredMonthlyIncome > 0);
    assert.equal(
      result.annualCashFlow[0].income,
      result.summary.requiredMonthlyIncome * 12
    );
  });

  it('values retirement spending at the retirement date', () => {
    const withoutReturn = calculateLifePlan(createLifePlanInput());
    const withReturn = calculateLifePlan(
      createLifePlanInput({
        assumptions: { realSavingsRate: 0.02 },
      })
    );

    assert.ok(
      withReturn.summary.targetRetirementFund <
        withoutReturn.summary.targetRetirementFund
    );
    assert.ok(
      withReturn.summary.requiredMonthlyIncome <
        withoutReturn.summary.requiredMonthlyIncome
    );
  });

  it('returns structured validation failures', () => {
    const result = safeCalculateLifePlan(
      createLifePlanInput({ retirementAge: 20, currentAge: 30 })
    );

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error.code, 'INVALID_INPUT');
    assert.ok(
      result.error.issues.some((issue) => issue.code === 'INVALID_AGE_ORDER')
    );
  });

  it('is deterministic across reproducible seeded inputs', () => {
    const random = mulberry32(20261013);

    for (let index = 0; index < 500; index += 1) {
      const currentAge = integer(random, 18, 55);
      const retirementAge = integer(random, currentAge + 1, 75);
      const endAge = integer(random, retirementAge + 1, 110);
      const input = createLifePlanInput({
        mode: random() > 0.5 ? 'have' : 'need',
        baseYear: integer(random, 2020, 2040),
        currentAge,
        retirementAge,
        endAge,
        monthlyIncome: integer(random, 0, 100_000),
        monthlyWorkingExpenses: integer(random, 0, 50_000),
        monthlyRetirementSelfFunded: integer(random, 0, 50_000),
        currentSavings: integer(random, 0, 10_000_000),
        assumptions: {
          realSavingsRate: integer(random, 0, 50) / 1_000,
          realBorrowingRate: integer(random, 0, 100) / 1_000,
          annualIncomeGrowthRate: integer(random, -20, 80) / 1_000,
          annualWorkingExpenseGrowthRate: integer(random, -20, 50) / 1_000,
          annualRetirementExpenseGrowthRate: integer(random, -20, 50) / 1_000,
        },
      });

      const first = calculateLifePlan(input);
      const second = calculateLifePlan(structuredClone(input));
      assert.deepEqual(second, first, `seed=20261013 case=${index}`);
      assert.ok(
        [
          first.summary.endingBalance,
          first.summary.minimumBalance,
          first.summary.requiredMonthlyIncome,
          ...first.annualCashFlow.flatMap((year) => [
            year.income,
            year.expenses,
            year.closingBalance,
          ]),
        ].every(Number.isFinite),
        `seed=20261013 case=${index}`
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
