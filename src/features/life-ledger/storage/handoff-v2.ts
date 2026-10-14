import { validateLifePlan, type LifePlan } from '../domain';

export const QUICK_HANDOFF_V2_KEY = 'life-ledger.quick-handoff.v2';
export const QUICK_HANDOFF_V2_TTL_MS = 30 * 60 * 1000;

export interface QuickPlanHandoffV2 {
  envelopeVersion: '2.0.0';
  source: 'landing-quick-estimate';
  createdAt: number;
  expiresAt: number;
  inputHash: string;
  plan: LifePlan;
}

export type HandoffV2ReadResult =
  | { ok: true; handoff: QuickPlanHandoffV2 }
  | {
      ok: false;
      reason: 'missing' | 'expired' | 'corrupt' | 'unsupported-version';
    };

export function writeQuickPlanHandoffV2(
  plan: LifePlan,
  inputHash: string,
  storage: Storage,
  now = Date.now()
) {
  if (!validateLifePlan(plan).valid || !inputHash) {
    throw new Error('Cannot hand off an invalid life plan.');
  }
  const handoff: QuickPlanHandoffV2 = {
    envelopeVersion: '2.0.0',
    source: 'landing-quick-estimate',
    createdAt: now,
    expiresAt: now + QUICK_HANDOFF_V2_TTL_MS,
    inputHash,
    plan,
  };
  storage.setItem(QUICK_HANDOFF_V2_KEY, JSON.stringify(handoff));
  return handoff;
}

export function readQuickPlanHandoffV2(
  storage: Storage,
  now = Date.now()
): HandoffV2ReadResult {
  const raw = storage.getItem(QUICK_HANDOFF_V2_KEY);
  if (!raw) return { ok: false, reason: 'missing' };
  try {
    const handoff = JSON.parse(raw) as QuickPlanHandoffV2;
    if (handoff.envelopeVersion !== '2.0.0') {
      return { ok: false, reason: 'unsupported-version' };
    }
    if (handoff.expiresAt <= now) return { ok: false, reason: 'expired' };
    if (
      handoff.source !== 'landing-quick-estimate' ||
      !handoff.inputHash ||
      !handoff.plan ||
      !validateLifePlan(handoff.plan).valid
    ) {
      return { ok: false, reason: 'corrupt' };
    }
    return { ok: true, handoff };
  } catch {
    return { ok: false, reason: 'corrupt' };
  }
}

export function clearQuickPlanHandoffV2(storage: Storage) {
  storage.removeItem(QUICK_HANDOFF_V2_KEY);
}
