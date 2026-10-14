import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createQuickLifePlan } from '../domain';
import { createPlanBackup, parsePlanBackup } from './backup';

describe('P2 plan backup', () => {
  it('round-trips a valid plan with version information', () => {
    const plan = createQuickLifePlan({ id: 'backup-plan' });
    const backup = createPlanBackup(plan);
    const restored = parsePlanBackup(JSON.stringify(backup));

    assert.equal(restored.formatVersion, '1.0.0');
    assert.equal(restored.plan.id, 'backup-plan');
    assert.deepEqual(restored.versions, plan.versions);
  });

  it('rejects unsupported and invalid backup files', () => {
    assert.throws(
      () => parsePlanBackup(JSON.stringify({ formatVersion: '2.0.0' })),
      /valid Life Ledger backup/
    );
    assert.throws(() => parsePlanBackup('{broken'));
  });
});
