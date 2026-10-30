import type { CashFlowItem, LifePlan, MonthIndex } from '../domain';

export const LIFE_STAGES = [
  'now',
  'career',
  'partner',
  'child',
  'parents',
  'housing',
  'retirement',
] as const;
export type LifeStage = (typeof LIFE_STAGES)[number];
export type OptionalLifeStage = Exclude<LifeStage, 'now' | 'retirement'>;
export interface LifeTrajectoryNode {
  stage: LifeStage;
  status: 'missing' | 'complete' | 'not-applicable';
  month: MonthIndex | null;
  age: number | null;
  targetSection: string;
  inputCount: number;
}

export function activeFlows(plan: LifePlan): CashFlowItem[] {
  return [
    ...plan.cashFlowBuckets.flatMap((b) =>
      b.mode === 'summary' ? (b.summary ? [b.summary] : []) : b.details
    ),
    ...plan.standaloneCashFlows,
  ];
}

export function stageFlows(plan: LifePlan, stage: LifeStage): CashFlowItem[] {
  return activeFlows(plan).filter((flow) => {
    if (
      flow.confirmation !== 'confirmed' ||
      (flow.amountCents <= 0 && !flow.incomeTreatment) ||
      flow.startMonth >= plan.endMonthExclusive ||
      flow.endMonthExclusive <= plan.baseMonth
    )
      return false;
    const owner = plan.members.find((m) => m.id === flow.ownerId);
    if (stage === 'career')
      return (
        plan.standaloneCashFlows.some((f) => f.id === flow.id) &&
        owner?.role === 'self' &&
        ['salary', 'side_income'].includes(flow.category)
      );
    if (stage === 'partner')
      return (
        owner?.role === 'partner' &&
        !['child', 'housing', 'parent'].includes(flow.category)
      );
    if (stage === 'child') return flow.category === 'child';
    if (stage === 'housing') return flow.category === 'housing';
    if (stage === 'parents') return flow.category === 'parent';
    return (
      stage === 'retirement' &&
      ['retirement', 'pension'].includes(flow.category)
    );
  });
}

export function extractLifeTrajectory(plan: LifePlan): LifeTrajectoryNode[] {
  const birth = plan.members.find(
    (m) => m.id === plan.primaryMemberId
  )?.birthMonth;
  return LIFE_STAGES.map((stage) => {
    const flows = stageFlows(plan, stage);
    const property =
      stage === 'housing' &&
      plan.assets.some(
        (a) =>
          a.kind === 'property' &&
          a.openingBalanceCents > 0 &&
          a.confirmation === 'confirmed'
      );
    const mortgages =
      stage === 'housing'
        ? plan.liabilities.filter(
            (l) =>
              l.kind === 'mortgage' &&
              l.confirmation === 'confirmed' &&
              l.openingPrincipalCents > 0 &&
              l.startMonth < plan.endMonthExclusive &&
              l.endMonthExclusive > plan.baseMonth
          )
        : [];
    const growth =
      stage === 'career' &&
      plan.cashFlowBuckets.some((b) =>
        (b.mode === 'summary'
          ? b.summary
            ? [b.summary]
            : []
          : b.details
        ).some(
          (f) =>
            f.category === 'salary' &&
            f.ownerId === plan.primaryMemberId &&
            f.annualGrowthBps !== 0
        )
      );
    const base = stage === 'now' || stage === 'retirement';
    const complete =
      base || growth || flows.length > 0 || property || mortgages.length > 0;
    const excluded =
      !base &&
      plan.metadata.excludedLifeStages?.includes(stage as OptionalLifeStage);
    const month =
      stage === 'now'
        ? plan.baseMonth
        : stage === 'retirement'
          ? plan.retirementMonth
          : complete
            ? (Math.max(
                plan.baseMonth,
                Math.min(
                  ...flows.map((f) => f.startMonth),
                  ...mortgages.map((l) => l.startMonth),
                  ...(property
                    ? plan.assets
                        .filter(
                          (a) =>
                            a.kind === 'property' &&
                            a.confirmation === 'confirmed' &&
                            a.openingBalanceCents > 0
                        )
                        .map((a) => a.acquiredMonth ?? plan.baseMonth)
                    : []),
                  ...(growth ? [plan.baseMonth] : [])
                )
              ) as MonthIndex)
            : null;
    return {
      stage,
      status: complete ? 'complete' : excluded ? 'not-applicable' : 'missing',
      month,
      age:
        month !== null && birth !== undefined
          ? Math.floor((month - birth) / 12)
          : null,
      targetSection: stage === 'now' ? 'assets' : stage,
      inputCount: flows.length + mortgages.length + (property ? 1 : 0),
    };
  });
}
