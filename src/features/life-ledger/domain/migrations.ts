import { createQuickLifePlan } from './factory';
import type { LifePlan } from './types';
import { validateLifePlan } from './validation';

export interface LegacyLifePlanV1 {
  schemaVersion?: '1.0.0';
  id?: string;
  mode?: 'have' | 'need';
  baseYear: number;
  currentAge: number;
  retirementAge: number;
  endAge: number;
  monthlyIncome: number;
  monthlyWorkingExpenses: number;
  monthlyRetirementSelfFunded: number;
  currentSavings: number;
}

export interface MigrationContext {
  planId: string;
  now: string;
}

export interface MigrationResult {
  plan: LifePlan;
  fromVersion: string;
  toVersion: '2.0.0';
  warnings: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isLegacyV1(value: unknown): value is LegacyLifePlanV1 {
  if (!isRecord(value)) return false;
  return [
    'baseYear',
    'currentAge',
    'retirementAge',
    'endAge',
    'monthlyIncome',
    'monthlyWorkingExpenses',
    'monthlyRetirementSelfFunded',
    'currentSavings',
  ].every((key) => typeof value[key] === 'number');
}

/** Pure migration: callers provide time and ID; the function never reads Date. */
export function migrateLifePlan(
  raw: unknown,
  context: MigrationContext
): MigrationResult {
  if (isRecord(raw) && raw.schemaVersion === '2.0.0') {
    const plan = raw as unknown as LifePlan;
    const validation = validateLifePlan(plan);
    if (!validation.valid) {
      throw new Error(
        `Invalid 2.0.0 plan: ${validation.issues.map((item) => item.code).join(', ')}`
      );
    }
    return { plan, fromVersion: '2.0.0', toVersion: '2.0.0', warnings: [] };
  }

  if (!isLegacyV1(raw)) {
    throw new Error('Unsupported or unrecognizable life plan schema.');
  }

  return {
    plan: createQuickLifePlan({
      id: raw.id ?? context.planId,
      baseYear: raw.baseYear,
      currentAge: raw.currentAge,
      retirementAge: raw.retirementAge,
      endAge: raw.endAge,
      monthlyIncomeYuan: raw.monthlyIncome,
      monthlyWorkingExpensesYuan: raw.monthlyWorkingExpenses,
      monthlyRetirementSelfFundedYuan: raw.monthlyRetirementSelfFunded,
      currentSavingsYuan: raw.currentSavings,
      now: context.now,
    }),
    fromVersion: raw.schemaVersion ?? 'legacy-unversioned',
    toVersion: '2.0.0',
    warnings: [
      'Legacy annual rates were not migrated because the v1 UI stored them as calculator-only assumptions.',
      'The v1 calculation mode is not persisted; P1 now reports both endpoint and no-gap income requirements.',
    ],
  };
}
