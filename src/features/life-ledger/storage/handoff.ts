import {
  CALCULATION_VERSIONS,
  validateLifePlanInput,
  type LifePlanInput,
} from '../calculation';

export const QUICK_HANDOFF_KEY = 'life-ledger.quick-handoff.v1';
export const QUICK_HANDOFF_TTL_MS = 30 * 60 * 1000;

export interface QuickPlanHandoff {
  schemaVersion: '1.0.0';
  source: 'landing-quick-estimate';
  createdAt: number;
  expiresAt: number;
  calculationVersion: string;
  input: LifePlanInput;
}

export type HandoffReadResult =
  | { ok: true; handoff: QuickPlanHandoff }
  | {
      ok: false;
      reason: 'missing' | 'expired' | 'corrupt' | 'unsupported-version';
    };

export function writeQuickPlanHandoff(
  input: LifePlanInput,
  storage: Storage,
  now = Date.now()
): QuickPlanHandoff {
  const validation = validateLifePlanInput(input);
  if (!validation.valid) {
    throw new Error('Cannot hand off an invalid life plan.');
  }

  const handoff: QuickPlanHandoff = {
    schemaVersion: '1.0.0',
    source: 'landing-quick-estimate',
    createdAt: now,
    expiresAt: now + QUICK_HANDOFF_TTL_MS,
    calculationVersion: CALCULATION_VERSIONS.calculation,
    input,
  };

  storage.setItem(QUICK_HANDOFF_KEY, JSON.stringify(handoff));
  return handoff;
}

export function readQuickPlanHandoff(
  storage: Storage,
  now = Date.now()
): HandoffReadResult {
  const raw = storage.getItem(QUICK_HANDOFF_KEY);
  if (!raw) return { ok: false, reason: 'missing' };

  try {
    const handoff = JSON.parse(raw) as QuickPlanHandoff;
    if (handoff.schemaVersion !== '1.0.0') {
      return { ok: false, reason: 'unsupported-version' };
    }
    if (handoff.expiresAt <= now) {
      return { ok: false, reason: 'expired' };
    }
    if (
      handoff.source !== 'landing-quick-estimate' ||
      !handoff.input ||
      !validateLifePlanInput(handoff.input).valid
    ) {
      return { ok: false, reason: 'corrupt' };
    }
    return { ok: true, handoff };
  } catch {
    return { ok: false, reason: 'corrupt' };
  }
}

export function clearQuickPlanHandoff(storage: Storage) {
  storage.removeItem(QUICK_HANDOFF_KEY);
}
