import type { OptionalLifeStage } from '../../analysis/extract-life-trajectory';
import {
  addMonths,
  basisPoints,
  yuan,
  type CashFlowItem,
  type LifePlan,
  type MonthIndex,
} from '../../domain';

export type EventStage = Exclude<OptionalLifeStage, 'career'> | 'events';
export interface EventInput {
  id: string;
  name: string;
  amountYuan: number;
  start: MonthIndex;
  end: MonthIndex;
  frequency: 'monthly' | 'once' | 'yearly';
  direction: 'income' | 'expense';
}
export function belongsToStage(
  plan: LifePlan,
  flow: CashFlowItem,
  stage: EventStage
) {
  if (stage === 'child') return flow.category === 'child';
  if (stage === 'housing') return flow.category === 'housing';
  if (stage === 'parents') return flow.category === 'parent';
  const partner = plan.members.some(
    (m) => m.id === flow.ownerId && m.role === 'partner'
  );
  if (stage === 'partner')
    return partner && !['child', 'housing', 'parent'].includes(flow.category);
  return (
    !partner &&
    ![
      'salary',
      'side_income',
      'child',
      'housing',
      'parent',
      'retirement',
      'pension',
    ].includes(flow.category)
  );
}
export function saveStageEvent(
  plan: LifePlan,
  stage: EventStage,
  input: EventInput
): LifePlan {
  const end =
    input.frequency === 'once' ? addMonths(input.start, 1) : input.end;
  if (
    !input.name.trim() ||
    !Number.isFinite(input.amountYuan) ||
    input.amountYuan <= 0 ||
    input.amountYuan > 1_000_000_000 ||
    input.start < plan.baseMonth ||
    input.start >= plan.endMonthExclusive ||
    end <= input.start ||
    end > plan.endMonthExclusive
  )
    throw new Error('Invalid event');
  const existing = plan.standaloneCashFlows.find((f) => f.id === input.id);
  const partnerId =
    plan.members.find((m) => m.role === 'partner')?.id ?? `${plan.id}:partner`;
  const flow: CashFlowItem = {
    id: input.id,
    name: input.name.trim(),
    direction: input.direction,
    category:
      stage === 'housing'
        ? 'housing'
        : stage === 'child'
          ? 'child'
          : stage === 'parents'
            ? 'parent'
            : 'other',
    ownerId:
      stage === 'partner'
        ? partnerId
        : (existing?.ownerId ?? plan.primaryMemberId),
    amountCents: yuan(input.amountYuan),
    frequency:
      input.frequency === 'once'
        ? { kind: 'once', postingMonth: input.start }
        : input.frequency === 'yearly'
          ? { kind: 'yearly', postingMonth: (input.start % 12) + 1 }
          : { kind: 'monthly' },
    startMonth: input.start,
    endMonthExclusive: end,
    annualGrowthBps: existing?.annualGrowthBps ?? basisPoints(0),
    source: { kind: 'user', label: '用户填写' },
    confirmation: 'confirmed',
  };
  return {
    ...plan,
    members:
      stage === 'partner' && !plan.members.some((m) => m.id === partnerId)
        ? [...plan.members, { id: partnerId, name: '家人', role: 'partner' }]
        : plan.members,
    standaloneCashFlows: existing
      ? plan.standaloneCashFlows.map((f) => (f.id === input.id ? flow : f))
      : [...plan.standaloneCashFlows, flow],
    metadata: {
      ...plan.metadata,
      excludedLifeStages: plan.metadata.excludedLifeStages?.filter(
        (s) => s !== stage
      ),
    },
  };
}
