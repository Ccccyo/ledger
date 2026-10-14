import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { calculateMonthlyLifePlan } from '../calculation';
import { monthIndex, validateLifePlan, yuan } from '../domain';
import { readQuickPlanHandoffV2, writeQuickPlanHandoffV2 } from '../storage';
import { MemoryStorage } from '../testing/memory-storage';
import {
  createPersonalBaselineDraft,
  createPersonalBaselinePlan,
  parsePersonalBaselineDraft,
} from './personal-baseline';

const CONTEXT = {
  id: 'personal-baseline-test',
  baseMonth: monthIndex(2026, 10),
  nowIso: '2026-10-14T00:00:00.000Z',
};

describe('P2.1 personal Landing baseline', () => {
  it('parses seven personal fields without coercing empty values', () => {
    const valid = parsePersonalBaselineDraft(
      createPersonalBaselineDraft({
        currentAge: 30,
        startingAvailableAssetsWan: 12,
        monthlyIncomeYuan: 10_000,
        monthlyExpenseYuan: 4_000,
        monthlyRetirementSelfFundedYuan: 3_000,
        retirementAge: 31,
        endAge: 32,
      })
    );
    assert.equal(valid.ok, true);
    if (valid.ok) assert.equal(Object.keys(valid.input).length, 7);

    const emptyIncome = createPersonalBaselineDraft();
    emptyIncome.monthlyIncomeYuan = '';
    assert.deepEqual(parsePersonalBaselineDraft(emptyIncome), {
      ok: false,
      issues: [{ field: 'monthlyIncomeYuan', code: 'required' }],
    });
  });

  it('validates age order and numeric boundaries', () => {
    const draft = createPersonalBaselineDraft();
    draft.currentAge = '60';
    draft.retirementAge = '60';
    draft.endAge = '59';
    assert.deepEqual(parsePersonalBaselineDraft(draft), {
      ok: false,
      issues: [
        { field: 'retirementAge', code: 'age-order' },
        { field: 'endAge', code: 'age-order' },
      ],
    });

    draft.currentAge = '17';
    draft.retirementAge = '60.5';
    draft.endAge = '121';
    assert.deepEqual(parsePersonalBaselineDraft(draft), {
      ok: false,
      issues: [
        { field: 'currentAge', code: 'out-of-range' },
        { field: 'retirementAge', code: 'invalid-number' },
        { field: 'endAge', code: 'out-of-range' },
      ],
    });
  });

  it('maps the personal baseline into one valid self-only formal plan', () => {
    const plan = createPersonalBaselinePlan(
      {
        currentAge: 30,
        startingAvailableAssetsWan: 12,
        monthlyIncomeYuan: 10_000,
        monthlyExpenseYuan: 4_000,
        monthlyRetirementSelfFundedYuan: 3_000,
        retirementAge: 31,
        endAge: 32,
      },
      CONTEXT
    );

    assert.equal(validateLifePlan(plan).valid, true);
    assert.deepEqual(
      plan.members.map((member) => member.role),
      ['self']
    );
    assert.equal(plan.assets.length, 1);
    assert.equal(plan.assets[0].openingBalanceCents, yuan(120_000));
    assert.equal(plan.liabilities.length, 0);

    const income = plan.cashFlowBuckets[0].summary!;
    const workingExpense = plan.cashFlowBuckets[1].summary!;
    const retirementExpense = plan.cashFlowBuckets[2].summary!;
    assert.equal(income.endMonthExclusive, plan.retirementMonth);
    assert.equal(workingExpense.endMonthExclusive, plan.retirementMonth);
    assert.equal(retirementExpense.startMonth, plan.retirementMonth);
    assert.equal(workingExpense.amountCents, yuan(4_000));
    assert.equal(retirementExpense.amountCents, yuan(3_000));
  });

  it('uses the formal monthly engine for the full Landing result', () => {
    const plan = createPersonalBaselinePlan(
      {
        currentAge: 30,
        startingAvailableAssetsWan: 12,
        monthlyIncomeYuan: 10_000,
        monthlyExpenseYuan: 4_000,
        monthlyRetirementSelfFundedYuan: 3_000,
        retirementAge: 31,
        endAge: 32,
      },
      { ...CONTEXT, baseMonth: monthIndex(2026, 1) }
    );
    const result = calculateMonthlyLifePlan(plan);

    assert.equal(result.monthly.length, 24);
    assert.equal(result.summary.endingAvailableCents, yuan(156_000));
    assert.equal(result.summary.hasAnyGap, false);
    assert.equal(result.inputHash.startsWith('fnv1a-'), true);
  });

  it('hands the exact plan and result into the workspace contract', () => {
    const plan = createPersonalBaselinePlan(
      {
        currentAge: 30,
        startingAvailableAssetsWan: 12,
        monthlyIncomeYuan: 10_000,
        monthlyExpenseYuan: 4_000,
        monthlyRetirementSelfFundedYuan: 3_000,
        retirementAge: 31,
        endAge: 32,
      },
      CONTEXT
    );
    const landingResult = calculateMonthlyLifePlan(plan);
    const storage = new MemoryStorage();
    writeQuickPlanHandoffV2(plan, landingResult.inputHash, storage, 1_000);

    const read = readQuickPlanHandoffV2(storage, 2_000);
    assert.equal(read.ok, true);
    if (!read.ok) return;

    const workspaceResult = calculateMonthlyLifePlan(read.handoff.plan);
    assert.equal(read.handoff.inputHash, landingResult.inputHash);
    assert.equal(workspaceResult.inputHash, landingResult.inputHash);
    assert.deepEqual(workspaceResult.summary, landingResult.summary);
    assert.deepEqual(workspaceResult.annual, landingResult.annual);
  });
});
