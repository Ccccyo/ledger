import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { calculateMonthlyLifePlan } from '../calculation';
import { addMonths, validateLifePlan, yuan } from '../domain';
import { createPlanBackup, parsePlanBackup } from '../storage/backup';
import {
  saveCareerChange,
  updateSalaryGrowth,
} from '../workspace/plan/career-mutations';
import { extractLifeTrajectory } from './extract-life-trajectory';
import { createPersonalBaselineFixture } from './fixtures';

describe('Career periods', () => {
  it('compounds annual real raises separately from new jobs and side income', () => {
    const base = createPersonalBaselineFixture();
    const raised = updateSalaryGrowth(
      base,
      3,
      base.baseMonth,
      addMonths(base.baseMonth, 12)
    );
    const rows = calculateMonthlyLifePlan(raised).monthly;
    assert.equal(rows[0].incomeCents, yuan(18000));
    assert.equal(rows[12].incomeCents, yuan(18540));
    assert.equal(rows[24].incomeCents, yuan(18540));
    const job = saveCareerChange(raised, {
      id: 'new-job',
      kind: 'salary',
      amount: 25000,
      start: addMonths(base.baseMonth, 12),
      end: addMonths(base.baseMonth, 36),
      name: 'Job',
      annualGrowthPercent: 2,
    });
    const updated = updateSalaryGrowth(job, 1);
    const result = calculateMonthlyLifePlan(updated);
    assert.equal(result.monthly[12].incomeCents, yuan(25000));
    assert.equal(result.monthly[24].incomeCents, yuan(25500));
    assert.equal(job.standaloneCashFlows[0].annualGrowthBps, 200);
    assert.equal(extractLifeTrajectory(raised)[1].status, 'complete');
    assert.throws(() => updateSalaryGrowth(base, -100));
  });
  it('replaces salary, adds side income and restores original salary after a pause', () => {
    const base = createPersonalBaselineFixture();
    const start = base.baseMonth;
    let plan = saveCareerChange(base, {
      id: 'raise',
      kind: 'salary',
      amount: 20000,
      start,
      end: addMonths(start, 2),
      name: 'New job',
    });
    plan = saveCareerChange(plan, {
      id: 'side',
      kind: 'side_income',
      amount: 3000,
      start,
      end: addMonths(start, 6),
      name: 'Side work',
    });
    plan = saveCareerChange(plan, {
      id: 'pause',
      kind: 'break',
      amount: 0,
      start: addMonths(start, 2),
      end: addMonths(start, 4),
      name: 'Break',
    });
    const result = calculateMonthlyLifePlan(plan);
    assert.deepEqual(
      result.monthly.slice(0, 7).map((r) => r.incomeCents),
      [23000, 23000, 3000, 3000, 21000, 21000, 18000].map(yuan)
    );
    assert.equal(
      result.summary.requiredIncome.endpointZeroMonthlyIncomeCents -
        result.summary.requiredIncome.endpointZeroSupplementCents,
      yuan(23000)
    );
    assert.equal(
      result.traces.some((t) => t.inputId === 'pause'),
      true
    );
    assert.equal(extractLifeTrajectory(plan)[1].status, 'complete');
    assert.equal(base.standaloneCashFlows.length, 0);
    assert.deepEqual(
      parsePlanBackup(JSON.stringify(createPlanBackup(plan))).plan
        .standaloneCashFlows,
      plan.standaloneCashFlows
    );
  });
  it('rejects conflicting overrides, dates and invalid imported treatment', () => {
    const base = createPersonalBaselineFixture();
    const input = {
      id: 'raise',
      kind: 'salary' as const,
      amount: 20000,
      start: base.baseMonth,
      end: addMonths(base.baseMonth, 12),
      name: 'Salary',
    };
    const plan = saveCareerChange(base, input);
    assert.throws(() => saveCareerChange(plan, { ...input, id: 'overlap' }));
    assert.throws(() =>
      saveCareerChange(base, {
        ...input,
        end: addMonths(base.retirementMonth, 1),
      })
    );
    assert.throws(() => saveCareerChange(base, { ...input, amount: -1 }));
    assert.throws(() =>
      saveCareerChange(base, { ...input, start: NaN as typeof base.baseMonth })
    );
    const edited = saveCareerChange(plan, { ...input, amount: 22000 });
    assert.equal(edited.standaloneCashFlows.length, 1);
    const invalid = structuredClone(plan);
    invalid.standaloneCashFlows[0].category = 'other';
    assert.equal(validateLifePlan(invalid).valid, false);
  });
  it('recognizes zero-income breaks and permits independent side income after retirement', () => {
    const base = createPersonalBaselineFixture();
    let plan = saveCareerChange(base, {
      id: 'break',
      kind: 'break',
      amount: 0,
      start: base.baseMonth,
      end: addMonths(base.baseMonth, 1),
      name: 'Break',
    });
    assert.equal(extractLifeTrajectory(plan)[1].status, 'complete');
    plan = saveCareerChange(plan, {
      id: 'late-side',
      kind: 'side_income',
      amount: 1000,
      start: base.retirementMonth,
      end: addMonths(base.retirementMonth, 1),
      name: 'Side work',
    });
    const rows = calculateMonthlyLifePlan(plan).monthly;
    assert.equal(
      rows.find((r) => r.month === base.retirementMonth)?.incomeCents,
      yuan(1000)
    );
    assert.equal(
      rows.find((r) => r.month === addMonths(base.retirementMonth, 1))
        ?.incomeCents,
      0
    );
  });
});
