import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createPersonalBaselineFixture } from '../analysis/fixtures';
import { calculateMonthlyLifePlan } from '../calculation';
import type { StoredPlanRecord } from '../storage';
import { initialWorkspaceState, workspaceReducer } from './workspace-reducer';

function createRecord(): StoredPlanRecord {
  const plan = createPersonalBaselineFixture();
  return {
    id: plan.id,
    schemaVersion: '2.0.0',
    revision: 1,
    checksum: 'fixture-checksum',
    plan,
    updatedAt: plan.metadata.updatedAt,
    writerId: 'fixture-writer',
  };
}

describe('P2.1 workspace reducer', () => {
  it('moves from bootstrap to a calculated ready state', () => {
    const record = createRecord();
    const ready = workspaceReducer(initialWorkspaceState, {
      type: 'plan/ready',
      record,
    });
    assert.equal(ready.boot.status, 'ready');
    assert.equal(ready.plan, record.plan);
    assert.equal(ready.calculationStatus, 'calculating');

    const result = calculateMonthlyLifePlan(record.plan);
    const calculated = workspaceReducer(ready, {
      type: 'calculation/success',
      result,
    });
    assert.equal(calculated.result, result);
    assert.equal(calculated.calculationStatus, 'idle');
    assert.equal(calculated.calculationError, null);
  });

  it('keeps the last valid result when a later calculation fails', () => {
    const record = createRecord();
    const result = calculateMonthlyLifePlan(record.plan);
    const ready = workspaceReducer(
      workspaceReducer(initialWorkspaceState, {
        type: 'plan/ready',
        record,
      }),
      { type: 'calculation/success', result }
    );
    const changed = workspaceReducer(ready, {
      type: 'plan/update',
      plan: { ...record.plan, name: '更新后的计划' },
    });
    const failed = workspaceReducer(changed, {
      type: 'calculation/failure',
      message: 'invalid',
    });

    assert.equal(changed.saveStatus, 'stale');
    assert.equal(failed.result, result);
    assert.equal(failed.calculationStatus, 'failed');
    assert.equal(failed.calculationError, 'invalid');
  });

  it('clears plan and result when the workspace is restarted', () => {
    const record = createRecord();
    const ready = workspaceReducer(initialWorkspaceState, {
      type: 'plan/ready',
      record,
    });
    const cleared = workspaceReducer(ready, { type: 'workspace/clear' });

    assert.equal(cleared.boot.status, 'empty');
    assert.equal(cleared.plan, null);
    assert.equal(cleared.result, null);
  });
  it('expires trials on external conflict while preserving local plan/result until explicit reload', () => {
    const record = createRecord();
    const result = calculateMonthlyLifePlan(record.plan);
    const ready = workspaceReducer(
      workspaceReducer(initialWorkspaceState, { type: 'plan/ready', record }),
      { type: 'calculation/success', result }
    );
    const conflicted = workspaceReducer(ready, {
      type: 'storage/conflict',
      message: 'another tab',
    });
    assert.equal(conflicted.plan, ready.plan);
    assert.equal(conflicted.result, result);
    assert.equal(conflicted.externalConflict, true);
    assert.equal(
      workspaceReducer(conflicted, { type: 'calculation/stale' }).saveStatus,
      'failed'
    );
    assert.equal(
      workspaceReducer(conflicted, { type: 'plan/update', plan: record.plan })
        .saveStatus,
      'failed'
    );
    assert.equal(
      workspaceReducer(conflicted, { type: 'save/status', status: 'saved' }),
      conflicted
    );
    assert.equal(
      workspaceReducer(conflicted, { type: 'error/clear' }),
      conflicted
    );
    assert.equal(
      workspaceReducer(conflicted, {
        type: 'simulation/apply',
        baselineHash: result.inputHash,
        candidatePlan: { ...record.plan, name: 'old trial' },
      }),
      conflicted
    );
    assert.equal(
      workspaceReducer(conflicted, { type: 'plan/ready', record })
        .externalConflict,
      false
    );
  });
});
