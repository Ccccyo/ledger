import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createLifePlanInput } from '../calculation';
import { createQuickLifePlan } from '../domain';
import { createLocalPlanDraft, saveLocalPlanDraft } from '../storage/drafts';
import { writeQuickPlanHandoff } from '../storage/handoff';
import { writeQuickPlanHandoffV2 } from '../storage/handoff-v2';
import type { StoredPlanRecord } from '../storage/plan-repository';
import { MemoryStorage } from '../testing/memory-storage';
import {
  decideWorkspaceBootstrap,
  findLegacyDraftCandidate,
} from './bootstrap';

const NOW = 10_000;

function storedRecord(id = 'stored'): StoredPlanRecord {
  return {
    id,
    schemaVersion: '2.0.0',
    revision: 3,
    checksum: 'test-checksum',
    plan: createQuickLifePlan({ id }),
    updatedAt: '2026-10-14T00:00:00.000Z',
    writerId: 'writer-test',
  };
}

describe('P2 workspace bootstrap decision', () => {
  it('prefers a valid v2 handoff over legacy and stored plans', () => {
    const sessionStorage = new MemoryStorage();
    const localStorage = new MemoryStorage();
    writeQuickPlanHandoff(
      createLifePlanInput({ monthlyIncome: 12_345 }),
      sessionStorage,
      NOW
    );
    writeQuickPlanHandoffV2(
      createQuickLifePlan({ id: 'incoming-v2' }),
      'hash-v2',
      sessionStorage,
      NOW
    );

    const decision = decideWorkspaceBootstrap({
      sessionStorage,
      localStorage,
      current: storedRecord(),
      now: NOW + 1,
    });

    assert.equal(decision.source, 'handoff-v2');
    if (decision.source === 'handoff-v2') {
      assert.equal(decision.plan.id, 'incoming-v2');
    }
  });

  it('falls back through v1, stored plan, legacy draft and empty in order', () => {
    const sessionStorage = new MemoryStorage();
    const localStorage = new MemoryStorage();
    const legacyInput = createLifePlanInput({ monthlyIncome: 22_222 });
    writeQuickPlanHandoff(legacyInput, sessionStorage, NOW);

    const fromV1 = decideWorkspaceBootstrap({
      sessionStorage,
      localStorage,
      current: storedRecord(),
      now: NOW + 1,
    });
    assert.equal(fromV1.source, 'handoff-v1');
    if (fromV1.source === 'handoff-v1') {
      assert.equal(fromV1.input.monthlyIncome, 22_222);
    }

    sessionStorage.clear();
    const fromStored = decideWorkspaceBootstrap({
      sessionStorage,
      localStorage,
      current: storedRecord('active'),
      now: NOW + 1,
    });
    assert.equal(fromStored.source, 'stored-plan');
    if (fromStored.source === 'stored-plan') {
      assert.equal(fromStored.record.id, 'active');
    }

    const draft = createLocalPlanDraft({
      id: 'legacy-draft',
      name: 'Legacy',
      input: legacyInput,
      source: 'direct',
      now: NOW,
    });
    saveLocalPlanDraft(draft, localStorage);
    const fromLegacyDraft = decideWorkspaceBootstrap({
      sessionStorage,
      localStorage,
      current: null,
      now: NOW + 1,
    });
    assert.equal(fromLegacyDraft.source, 'legacy-draft');
    if (fromLegacyDraft.source === 'legacy-draft') {
      assert.equal(fromLegacyDraft.draft.id, 'legacy-draft');
    }

    localStorage.clear();
    assert.deepEqual(
      decideWorkspaceBootstrap({
        sessionStorage,
        localStorage,
        current: null,
        now: NOW + 1,
      }),
      { source: 'empty' }
    );
  });

  it('does not let an expired v2 handoff hide a stored plan', () => {
    const sessionStorage = new MemoryStorage();
    const localStorage = new MemoryStorage();
    writeQuickPlanHandoffV2(
      createQuickLifePlan({ id: 'expired' }),
      'expired-hash',
      sessionStorage,
      NOW
    );

    const decision = decideWorkspaceBootstrap({
      sessionStorage,
      localStorage,
      current: storedRecord('safe-current'),
      now: NOW + 31 * 60 * 1000,
    });

    assert.equal(decision.source, 'stored-plan');
    if (decision.source === 'stored-plan') {
      assert.equal(decision.record.id, 'safe-current');
    }
  });

  it('skips unreadable legacy values while scanning', () => {
    const storage = new MemoryStorage();
    storage.setItem('life-ledger.plan.v1.broken', '{broken');
    storage.setItem(
      'life-ledger.plan.v1.valid',
      JSON.stringify({ id: 'valid', input: createLifePlanInput() })
    );

    assert.equal(findLegacyDraftCandidate(storage)?.id, 'valid');
  });
});
