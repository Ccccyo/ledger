import type { LifePlanInput } from '../calculation';
import type { LifePlan } from '../domain';
import { readQuickPlanHandoff } from '../storage/handoff';
import { readQuickPlanHandoffV2 } from '../storage/handoff-v2';
import type { StoredPlanRecord } from '../storage/plan-repository';

export interface LegacyDraftCandidate {
  key: string;
  id: string;
  input: unknown;
}

export type WorkspaceBootstrapDecision =
  | { source: 'handoff-v2'; plan: LifePlan }
  | { source: 'handoff-v1'; input: LifePlanInput }
  | { source: 'stored-plan'; record: StoredPlanRecord }
  | { source: 'legacy-draft'; draft: LegacyDraftCandidate }
  | { source: 'empty' };

export function findLegacyDraftCandidate(
  storage: Storage
): LegacyDraftCandidate | null {
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key?.startsWith('life-ledger.plan.v1.')) continue;
    try {
      const draft = JSON.parse(storage.getItem(key) || '') as {
        id?: unknown;
        input?: unknown;
      };
      if (typeof draft.id === 'string' && draft.input) {
        return { key, id: draft.id, input: draft.input };
      }
    } catch {
      // Ignore unreadable legacy values and keep looking for a usable draft.
    }
  }
  return null;
}

/**
 * Chooses a single startup source without mutating storage. Callers only clear
 * temporary handoffs after the selected plan has been durably persisted.
 */
export function decideWorkspaceBootstrap({
  sessionStorage,
  localStorage,
  current,
  now = Date.now(),
}: {
  sessionStorage: Storage;
  localStorage: Storage;
  current: StoredPlanRecord | null;
  now?: number;
}): WorkspaceBootstrapDecision {
  const handoffV2 = readQuickPlanHandoffV2(sessionStorage, now);
  if (handoffV2.ok) {
    return { source: 'handoff-v2', plan: handoffV2.handoff.plan };
  }

  const handoffV1 = readQuickPlanHandoff(sessionStorage, now);
  if (handoffV1.ok) {
    return { source: 'handoff-v1', input: handoffV1.handoff.input };
  }

  if (current) return { source: 'stored-plan', record: current };

  const legacyDraft = findLegacyDraftCandidate(localStorage);
  if (legacyDraft) return { source: 'legacy-draft', draft: legacyDraft };

  return { source: 'empty' };
}
