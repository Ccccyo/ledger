import assert from 'node:assert/strict';
import { it } from 'node:test';

import { createPersonalBaselineFixture } from '../analysis/fixtures';
import { calculateMonthlyLifePlan } from '../calculation';
import { commitPlanEdit } from './commit-plan-edit';

it('accepted edits update provenance without changing calculations or mutating previews', () => {
  const current = createPersonalBaselineFixture();
  const next = { ...current, name: 'Updated plan' };
  const before = structuredClone(next);
  const updatedAt = '2026-10-15T12:30:00.000Z';
  const committed = commitPlanEdit(current, next, updatedAt);
  assert.equal(committed.metadata.updatedAt, updatedAt);
  assert.deepEqual(next, before);
  assert.equal(current.metadata.updatedAt, before.metadata.updatedAt);
  assert.deepEqual(
    calculateMonthlyLifePlan(committed).summary,
    calculateMonthlyLifePlan(next).summary
  );
  assert.equal(commitPlanEdit(current, current, updatedAt), current);
});
