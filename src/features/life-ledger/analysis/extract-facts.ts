import type { MonthlyCalculationResult } from '../calculation';
import type { LifePlan } from '../domain';
import { extractLifeTrajectory, stageFlows } from './extract-life-trajectory';

export function extractPlanFacts(
  plan: LifePlan,
  result: MonthlyCalculationResult
) {
  const minimum = result.monthly.reduce((a, b) =>
    a.closingAvailableCents <= b.closingAvailableCents ? a : b
  );
  const peak = result.annual.reduce((a, b) =>
    a.expenseCents >= b.expenseCents ? a : b
  );
  return {
    firstGapMonth: result.summary.firstGapMonth,
    minimumMonth:
      result.monthly[0].openingAvailableCents <= minimum.closingAvailableCents
        ? plan.baseMonth
        : minimum.month,
    minimumAvailableCents: result.summary.minimumAvailableCents,
    endingAvailableCents: result.summary.endingAvailableCents,
    endingNetWorthCents: result.summary.endingNetWorthCents,
    retirementMonth: plan.retirementMonth,
    largestExpenseYear: peak.year,
    largestExpenseCategories: Object.entries(peak.expenseByCategory)
      .sort((a, b) => b[1] - a[1])
      .map(([k]) => k),
    housing: stageFlows(plan, 'housing'),
    children: stageFlows(plan, 'child'),
    retirement: stageFlows(plan, 'retirement'),
    missingSections: extractLifeTrajectory(plan)
      .filter((n) => n.status === 'missing')
      .map((n) => n.stage),
    topInfluences: result.summary.topInfluences,
    liquidGap: result.monthly.find(
      (r) => r.closingAvailableCents < 0 && r.netWorthCents > 0
    ),
    positiveMonths: result.monthly.filter((r) => r.closingAvailableCents > 0)
      .length,
    unclassifiedBuckets: plan.cashFlowBuckets.filter(
      (b) =>
        b.mode === 'summary' &&
        b.summary &&
        b.summary.amountCents > 0 &&
        b.direction === 'expense'
    ),
  };
}
export type PlanFacts = ReturnType<typeof extractPlanFacts>;
