import type { ResultChange } from '../analysis/digest-result';
import type { MonthlyCalculationResult } from '../calculation';
import type { LifePlan } from '../domain';
import type { StoredPlanRecord } from '../storage';

export type WorkspaceCopy = Record<string, any>;

export type WorkspaceTab = 'overview' | 'plan' | 'ledger';

export type SaveStatus = 'saved' | 'saving' | 'failed' | 'stale';

export type CalculationStatus = 'idle' | 'calculating' | 'failed';

export type BootState =
  | { status: 'loading' }
  | { status: 'empty'; reason?: string }
  | { status: 'error'; message: string }
  | { status: 'ready'; record: StoredPlanRecord };

export interface WorkspaceState {
  boot: BootState;
  plan: LifePlan | null;
  result: MonthlyCalculationResult | null;
  saveStatus: SaveStatus;
  calculationStatus: CalculationStatus;
  calculationError: string | null;
  storageError: string | null;
  externalConflict: boolean;
  pendingChange: boolean;
  resultChange: ResultChange | null;
  appliedSnapshot: { before: LifePlan; applied: LifePlan } | null;
}

export type WorkspaceAction =
  | { type: 'boot/loading' }
  | { type: 'boot/empty'; reason?: string }
  | { type: 'boot/error'; message: string }
  | { type: 'plan/ready'; record: StoredPlanRecord }
  | { type: 'plan/update'; plan: LifePlan }
  | { type: 'plan/edit'; updater: (plan: LifePlan) => LifePlan }
  | { type: 'simulation/apply'; baselineHash: string; candidatePlan: LifePlan }
  | { type: 'simulation/undo' }
  | { type: 'calculation/stale' }
  | { type: 'calculation/success'; result: MonthlyCalculationResult }
  | { type: 'calculation/failure'; message: string }
  | { type: 'save/status'; status: SaveStatus }
  | { type: 'error/set'; message: string }
  | { type: 'storage/conflict'; message: string }
  | { type: 'error/clear' }
  | { type: 'workspace/clear' };
