import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { calculateMonthlyLifePlan } from '../calculation';
import { addMonths, createQuickLifePlan } from '../domain';
import { saveStageEvent } from '../workspace/plan/event-mutations';
import {
  buildMilestones,
  groupMilestonesByYear,
  selectPrimaryMilestones,
} from './milestones';

describe('milestone adapter', () => {
  it('combines plan events with deterministic result milestones', () => {
    let plan = createQuickLifePlan({
      id: 'milestone-combined',
      baseYear: 2026,
      currentAge: 30,
      retirementAge: 60,
      endAge: 65,
      currentSavingsYuan: 0,
      monthlyIncomeYuan: 0,
      monthlyWorkingExpensesYuan: 1000,
      monthlyRetirementSelfFundedYuan: 1000,
    });
    plan = saveStageEvent(plan, 'child', {
      id: 'school',
      name: '开始上学',
      amountYuan: 1000,
      start: addMonths(plan.baseMonth, 12),
      end: addMonths(plan.baseMonth, 13),
      frequency: 'once',
      direction: 'expense',
    });
    const result = calculateMonthlyLifePlan(plan);
    const milestones = buildMilestones(plan, result);

    assert.ok(milestones.some((marker) => marker.kind === 'child'));
    assert.equal(
      milestones.filter((marker) => marker.kind === 'first-gap').length,
      1
    );
    assert.equal(
      milestones.filter((marker) => marker.kind === 'minimum-cash').length,
      1
    );
    assert.ok(
      milestones.every(
        (marker, index) =>
          index === 0 || marker.month >= milestones[index - 1].month
      )
    );
  });

  it('does not invent ages when the primary member has no birth month', () => {
    const plan = createQuickLifePlan({ id: 'milestone-no-birth' });
    const withoutBirth = {
      ...plan,
      members: plan.members.map((member) => ({
        id: member.id,
        name: member.name,
        role: member.role,
      })),
    };
    const milestones = buildMilestones(
      withoutBirth,
      calculateMonthlyLifePlan(withoutBirth)
    );
    assert.ok(milestones.length > 0);
    assert.ok(milestones.every((marker) => marker.age === null));
  });

  it('groups multiple markers in the same year without losing identities', () => {
    const plan = createQuickLifePlan({
      id: 'milestone-group',
      baseYear: 2026,
      currentAge: 30,
      retirementAge: 60,
      endAge: 65,
    });
    const result = calculateMonthlyLifePlan(plan);
    const markers = buildMilestones(plan, result);
    const groups = groupMilestonesByYear(markers);
    const markerCount = groups.reduce(
      (sum, group) => sum + group.markers.length,
      0
    );
    assert.equal(markerCount, markers.length);
    assert.equal(
      new Set(groups.flatMap((group) => group.markers.map((m) => m.id))).size,
      markers.length
    );
  });

  it('keeps high-value system markers on a bounded primary axis', () => {
    let plan = createQuickLifePlan({
      id: 'milestone-primary',
      baseYear: 2026,
      currentAge: 30,
      retirementAge: 60,
      endAge: 65,
      currentSavingsYuan: 0,
      monthlyIncomeYuan: 0,
      monthlyWorkingExpensesYuan: 1000,
      monthlyRetirementSelfFundedYuan: 1000,
    });
    for (let index = 0; index < 8; index += 1) {
      plan = saveStageEvent(plan, 'events', {
        id: `event-${index}`,
        name: `Event ${index}`,
        amountYuan: 1000,
        start: addMonths(plan.baseMonth, index + 1),
        end: addMonths(plan.baseMonth, index + 2),
        frequency: 'once',
        direction: 'expense',
      });
    }
    const markers = buildMilestones(plan, calculateMonthlyLifePlan(plan));
    const primary = selectPrimaryMilestones(markers, 7);
    assert.equal(primary.length, 7);
    assert.ok(primary.some((marker) => marker.kind === 'first-gap'));
    assert.ok(primary.some((marker) => marker.kind === 'minimum-cash'));
    assert.ok(primary.some((marker) => marker.kind === 'retirement'));
  });
});
