import {
  calculateMonthlyLifePlan,
  type MonthlyCalculationResult,
} from '../calculation';
import type { LifePlan } from '../domain';
import { applyPlanPatch, type PlanPatch } from './action-patches';
import { compareResults } from './digest-result';

export function simulateAction(
  plan: LifePlan,
  baseline: MonthlyCalculationResult,
  patch: PlanPatch
) {
  const candidatePlan = applyPlanPatch(plan, patch);
  const candidateResult = calculateMonthlyLifePlan(candidatePlan);
  return {
    baselineHash: baseline.inputHash,
    candidatePlan,
    candidateResult,
    change: compareResults(baseline, candidateResult),
    patch,
  };
}
export type SimulationComparison = ReturnType<typeof simulateAction>;

export function simulateScenario(
  plan: LifePlan,
  baseline: MonthlyCalculationResult,
  patches: PlanPatch[]
) {
  if (patches.length < 2 || patches.length > 3) {
    throw new Error('A combined scenario needs two or three changes.');
  }
  const candidatePlan = patches.reduce(
    (current, patch) => applyPlanPatch(current, patch),
    plan
  );
  const candidateResult = calculateMonthlyLifePlan(candidatePlan);
  return {
    baselineHash: baseline.inputHash,
    candidatePlan,
    candidateResult,
    change: compareResults(baseline, candidateResult),
    patch: { type: 'scenario' as const, patches },
  };
}

export type ScenarioComparison = ReturnType<typeof simulateScenario>;

export function verifyCause(
  plan: LifePlan,
  baseline: MonthlyCalculationResult,
  patch: PlanPatch
) {
  const comparison = simulateAction(plan, baseline, patch);
  const before = baseline.summary.firstGapMonth,
    after = comparison.candidateResult.summary.firstGapMonth;
  return {
    verified: before !== null && (after === null || after > before),
    change: comparison.change,
  };
}
