import {
  CALCULATION_VERSIONS,
  validateLifePlanInput,
  type LifePlanInput,
} from '../calculation';

const PLAN_KEY_PREFIX = 'life-ledger.plan.v1.';

export interface LocalPlanDraft {
  schemaVersion: '1.0.0';
  id: string;
  name: string;
  status: 'draft';
  source: 'landing-quick-estimate' | 'direct';
  createdAt: number;
  updatedAt: number;
  calculationVersion: string;
  input: LifePlanInput;
}

export function createLocalPlanDraft({
  id,
  name,
  input,
  source,
  now = Date.now(),
}: {
  id: string;
  name: string;
  input: LifePlanInput;
  source: LocalPlanDraft['source'];
  now?: number;
}): LocalPlanDraft {
  if (!validateLifePlanInput(input).valid) {
    throw new Error('Cannot create a draft from invalid input.');
  }

  return {
    schemaVersion: '1.0.0',
    id,
    name,
    status: 'draft',
    source,
    createdAt: now,
    updatedAt: now,
    calculationVersion: CALCULATION_VERSIONS.calculation,
    input,
  };
}

export function saveLocalPlanDraft(draft: LocalPlanDraft, storage: Storage) {
  storage.setItem(`${PLAN_KEY_PREFIX}${draft.id}`, JSON.stringify(draft));
}

export function readLocalPlanDraft(
  id: string,
  storage: Storage
): LocalPlanDraft | null {
  const raw = storage.getItem(`${PLAN_KEY_PREFIX}${id}`);
  if (!raw) return null;

  try {
    const draft = JSON.parse(raw) as LocalPlanDraft;
    if (
      draft.schemaVersion !== '1.0.0' ||
      draft.id !== id ||
      !draft.input ||
      !validateLifePlanInput(draft.input).valid
    ) {
      return null;
    }
    return draft;
  } catch {
    return null;
  }
}
