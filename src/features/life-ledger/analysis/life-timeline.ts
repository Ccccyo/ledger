import { addMonths, type LifePlan, type MonthIndex } from '../domain';

export interface TimelineEvent {
  id: string;
  month: MonthIndex;
  end?: MonthIndex;
  name: string;
  kind:
    | 'start'
    | 'end'
    | 'retirement'
    | 'event'
    | 'relocation'
    | 'loan_end';
  target: string;
  prominence: number;
}
export function lifeTimeline(plan: LifePlan): TimelineEvent[] {
  const events: TimelineEvent[] = [
    {
      id: 'start',
      month: plan.baseMonth,
      name: '',
      kind: 'start',
      target: 'assets',
      prominence: 0,
    },
    {
      id: 'retirement',
      month: plan.retirementMonth,
      name: '',
      kind: 'retirement',
      target: 'retirement',
      prominence: 100,
    },
    {
      id: 'end',
      month: addMonths(plan.endMonthExclusive, -1),
      name: '',
      kind: 'end',
      target: 'basics',
      prominence: 0,
    },
  ];
  const purchaseFlows = new Set(
    plan.assets.map((a) => a.purchase?.downPaymentFlowId)
  );
  for (const relocation of plan.metadata.relocations ?? []) {
    events.push({
      id: `relocation:${relocation.id}`,
      month: relocation.moveMonth,
      name: relocation.targetCity,
      kind: 'relocation',
      target: `housing:relocation:${relocation.id}`,
      prominence: 96,
    });
  }
  for (const f of plan.standaloneCashFlows) {
    if (f.confirmation !== 'confirmed' || purchaseFlows.has(f.id)) continue;
    const owner = plan.members.find((m) => m.id === f.ownerId);
    const target =
      f.category === 'housing'
        ? 'housing'
        : f.category === 'child'
          ? 'child'
          : f.category === 'parent'
            ? 'parents'
            : ['salary', 'side_income'].includes(f.category)
              ? 'career'
              : owner?.role === 'partner'
                ? 'partner'
                : 'events';
    events.push({
      id: f.id,
      month: f.startMonth,
      end:
        f.frequency.kind === 'once'
          ? undefined
          : addMonths(f.endMonthExclusive, -1),
      name: f.name,
      kind: 'event',
      target,
      prominence:
        f.frequency.kind !== 'once'
          ? 0
          : f.category === 'child'
            ? 90
            : owner?.role === 'partner'
              ? 80
              : target === 'events'
                ? 70
                : 0,
    });
  }
  for (const a of plan.assets)
    if (a.purchase && a.acquiredMonth !== undefined)
      events.push({
        id: a.id,
        month: a.acquiredMonth,
        name: a.name,
        kind: 'event',
        target: 'housing',
        prominence: 95,
      });
  for (const l of plan.liabilities)
    if (l.kind === 'mortgage' && l.confirmation === 'confirmed')
      events.push({
        id: `${l.id}:end`,
        month: addMonths(l.endMonthExclusive, -1),
        name: l.name,
        kind: 'loan_end',
        target: 'housing',
        prominence: 0,
      });
  return events
    .filter(
      (e) => e.month >= plan.baseMonth && e.month < plan.endMonthExclusive
    )
    .sort((a, b) => a.month - b.month || a.id.localeCompare(b.id));
}

/** A deliberately small set of user-facing life milestones for the main axis. */
export function primaryTimelineEvents(
  plan: LifePlan,
  maximum = 5
): TimelineEvent[] {
  const events = lifeTimeline(plan);
  const retirement = events.find((event) => event.kind === 'retirement');
  const choices = events
    .filter((event) => event.prominence > 0 && event.kind !== 'retirement')
    .sort(
      (a, b) =>
        b.prominence - a.prominence ||
        a.month - b.month ||
        a.id.localeCompare(b.id)
    )
    .slice(0, Math.max(0, maximum - (retirement ? 1 : 0)));
  return [...choices, ...(retirement ? [retirement] : [])]
    .slice(0, maximum)
    .sort((a, b) => a.month - b.month || a.id.localeCompare(b.id));
}
