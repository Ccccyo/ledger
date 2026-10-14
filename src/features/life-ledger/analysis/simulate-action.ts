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
