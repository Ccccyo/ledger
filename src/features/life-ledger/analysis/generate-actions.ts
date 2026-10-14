import type { MonthlyCalculationResult } from '../calculation';
import { moneyCents, type LifePlan } from '../domain';
import type { PlanPatch } from './action-patches';
import { stageFlows } from './extract-life-trajectory';
import type { PlanInsight } from './generate-insights';

export interface ActionCandidate {
  id: string;
  kind: 'delay-housing' | 'retirement-budget' | 'retire-later' | 'opening-cash';
  patch: PlanPatch;
}
export function generateActions(
  plan: LifePlan,
  result: MonthlyCalculationResult,
  insights: PlanInsight[]
): ActionCandidate[] {
  const actions: ActionCandidate[] = [];
  const housing = stageFlows(plan, 'housing').find(
    (f) =>
      f.frequency.kind === 'once' &&
      f.endMonthExclusive + 12 <= plan.endMonthExclusive
  );
  if (housing && insights.some((i) => i.target === 'housing'))
    actions.push({
      id: `delay:${housing.id}`,
      kind: 'delay-housing',
      patch: {
        type: 'shift-cash-flow',
        cashFlowId: housing.id,
        monthDelta: 12,
      },
    });
  const retirement = stageFlows(plan, 'retirement').find(
    (f) => f.direction === 'expense' && f.amountCents > 0
  );
  if (retirement)
    actions.push({
      id: `budget:${retirement.id}`,
      kind: 'retirement-budget',
      patch: {
        type: 'change-cash-flow-amount',
        cashFlowId: retirement.id,
        amountCents: moneyCents(Math.round(retirement.amountCents * 0.9)),
      },
    });
  if (plan.retirementMonth + 12 < plan.endMonthExclusive)
    actions.push({
      id: 'retire-later',
      kind: 'retire-later',
      patch: {
        type: 'change-retirement-month',
        retirementMonth: (plan.retirementMonth +
          12) as LifePlan['retirementMonth'],
      },
    });
  const cash = plan.assets.find((a) => a.liquid);
  if (cash && result.summary.hasAnyGap)
    actions.push({
      id: 'opening-cash',
      kind: 'opening-cash',
      patch: {
        type: 'change-liquid-opening-balance',
        assetId: cash.id,
        openingBalanceCents: moneyCents(cash.openingBalanceCents + 1000000),
      },
    });
  return actions.slice(0, 3);
}
