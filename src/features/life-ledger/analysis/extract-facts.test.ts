import assert from 'node:assert/strict';
import { it } from 'node:test';

import { calculateMonthlyLifePlan } from '../calculation';
import { createQuickLifePlan } from '../domain';
import { extractPlanFacts } from './extract-facts';

it('reports the opening month when initial funds are lower than every closing month', () => {
  const plan = createQuickLifePlan({
    id: 'opening-minimum',
    name: 'test',
    baseYear: 2026,
    currentAge: 30,
    retirementAge: 60,
    endAge: 61,
    monthlyIncomeYuan: 20000,
    monthlyWorkingExpensesYuan: 1000,
    monthlyRetirementSelfFundedYuan: 1000,
    currentSavingsYuan: 0,
    now: '2026-10-14T00:00:00.000Z',
  });
  const result = calculateMonthlyLifePlan(plan);
  const facts = extractPlanFacts(plan, result);
  assert.equal(facts.minimumAvailableCents, 0);
  assert.equal(facts.minimumMonth, plan.baseMonth);
  assert.ok(result.monthly.every((row) => row.closingAvailableCents > 0));
});
