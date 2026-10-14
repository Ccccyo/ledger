import assert from 'node:assert/strict';
import { it } from 'node:test';

import { snapshotCandidates, type StoredPlanSnapshot } from './plan-repository';

it('recovery never selects another plan when snapshot timestamps tie', () => {
  const snapshots = [
    { planId: 'old-plan', revision: 99, createdAt: '2026-10-14T00:00:00Z' },
    { planId: 'active-plan', revision: 1, createdAt: '2026-10-14T00:00:00Z' },
    { planId: 'active-plan', revision: 2, createdAt: '2026-10-14T00:00:00Z' },
  ] as StoredPlanSnapshot[];
  assert.deepEqual(
    snapshotCandidates(snapshots, 'active-plan').map((s) => s.revision),
    [2, 1]
  );
  assert.deepEqual(snapshotCandidates(snapshots, 'missing-plan'), []);
  assert.equal(snapshots[0].planId, 'old-plan');
});
