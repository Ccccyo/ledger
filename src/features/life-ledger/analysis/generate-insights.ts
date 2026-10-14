import type { MonthlyCalculationResult } from '../calculation';
import { moneyCents, type LifePlan } from '../domain';
import { extractPlanFacts, type PlanFacts } from './extract-facts';
import { verifyCause } from './simulate-action';

export const ANALYSIS_VERSION = '1.0.0';
export const RULE_IDS = [
  'housing-causes-first-gap',
  'housing-child-overlap',
  'liquidity-gap',
  'retirement-transition-gap',
  'retirement-spend-sensitive',
  'zero-return-conservative',
  'important-total-unclassified',
  'baseline-sustainable',
] as const;
export type RuleId = (typeof RULE_IDS)[number];
export interface PlanInsight {
  ruleId: RuleId;
  severity: 'gap' | 'attention' | 'info';
  target: string;
  inputIds: string[];
  traceIds: string[];
  verifiedCause: boolean;
}
export function ruleMatches(id: RuleId, plan: LifePlan, facts: PlanFacts) {
  switch (id) {
    case 'housing-causes-first-gap':
      return (
        facts.firstGapMonth !== null &&
        facts.housing.some(
          (f) =>
            f.frequency.kind === 'once' &&
            Math.abs(f.startMonth - facts.firstGapMonth!) <= 12
        )
      );
    case 'housing-child-overlap':
      return facts.housing.some((h) =>
        facts.children.some(
          (c) =>
            Math.abs(c.startMonth - h.startMonth) <= 24 &&
            c.endMonthExclusive > h.startMonth
        )
      );
    case 'liquidity-gap':
      return Boolean(facts.liquidGap);
    case 'retirement-transition-gap':
      return (
        facts.firstGapMonth !== null &&
        facts.firstGapMonth >= plan.retirementMonth &&
        facts.firstGapMonth < plan.retirementMonth + 12 &&
        !facts.retirement.some(
          (f) =>
            f.direction === 'income' && f.startMonth <= facts.firstGapMonth!
        )
      );
    case 'retirement-spend-sensitive':
      return facts.retirement.some(
        (f) =>
          f.direction === 'expense' &&
          facts.topInfluences.some((i) => i.inputId === f.id)
      );
    case 'zero-return-conservative':
      return (
        plan.assumptions.annualLiquidReturnBps === 0 &&
        facts.positiveMonths >= 120
      );
    case 'important-total-unclassified':
      return facts.unclassifiedBuckets.length > 0;
    case 'baseline-sustainable':
      return facts.firstGapMonth === null && facts.missingSections.length === 0;
  }
}
export function generateInsights(
  plan: LifePlan,
  result: MonthlyCalculationResult
): PlanInsight[] {
  const f = extractPlanFacts(plan, result);
  const matched: PlanInsight[] = RULE_IDS.filter((id) =>
    ruleMatches(id, plan, f)
  ).map((ruleId) => {
    const target = ruleId.startsWith('housing')
      ? 'housing'
      : ruleId.startsWith('retirement')
        ? 'retirement'
        : ruleId === 'liquidity-gap'
          ? 'assets'
          : ruleId === 'zero-return-conservative'
            ? 'advanced'
            : ruleId === 'important-total-unclassified'
              ? 'living'
              : 'basics';
    const inputIds =
      target === 'housing'
        ? f.housing.map((i) => i.id)
        : target === 'retirement'
          ? f.retirement.map((i) => i.id)
          : target === 'assets'
            ? plan.assets.filter((a) => !a.liquid).map((a) => a.id)
            : target === 'living'
              ? f.unclassifiedBuckets.flatMap((b) =>
                  b.summary ? [b.summary.id] : []
                )
              : [];
    let verifiedCause = false;
    if (ruleId === 'housing-causes-first-gap') {
      const flow = f.housing.find(
        (h) =>
          h.frequency.kind === 'once' &&
          Math.abs(h.startMonth - f.firstGapMonth!) <= 12
      );
      if (flow)
        try {
          verifiedCause = verifyCause(plan, result, {
            type: 'change-cash-flow-amount',
            cashFlowId: flow.id,
            amountCents: moneyCents(0),
          }).verified;
        } catch {
          /* No causal claim if a controlled calculation cannot be made. */
        }
    }
    return {
      ruleId,
      target,
      inputIds,
      traceIds: result.traces
        .filter((t) => t.inputId && inputIds.includes(t.inputId))
        .slice(0, 12)
        .map((t) => t.id),
      verifiedCause,
      severity: ([
        'housing-causes-first-gap',
        'liquidity-gap',
        'retirement-transition-gap',
      ].includes(ruleId)
        ? 'gap'
        : ruleId === 'baseline-sustainable' ||
            ruleId === 'zero-return-conservative'
          ? 'info'
          : 'attention') as PlanInsight['severity'],
    };
  });
  const rank = { gap: 0, attention: 1, info: 2 };
  matched.sort(
    (a, b) =>
      rank[a.severity] - rank[b.severity] ||
      Number(b.verifiedCause) - Number(a.verifiedCause) ||
      RULE_IDS.indexOf(a.ruleId) - RULE_IDS.indexOf(b.ruleId)
  );
  const targets = new Set<string>();
  return matched
    .filter((i) => {
      if (targets.has(i.target)) return false;
      targets.add(i.target);
      return true;
    })
    .slice(0, 3);
}
