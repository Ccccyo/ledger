import type { MonthlyCalculationResult } from '../calculation';
import { monthParts, type LifePlan, type MonthIndex } from '../domain';
import { extractPlanFacts } from './extract-facts';
import { lifeTimeline, type TimelineEvent } from './life-timeline';

export type MilestoneKind =
  | 'start'
  | 'career'
  | 'partner'
  | 'child'
  | 'housing'
  | 'relocation'
  | 'parents'
  | 'retirement'
  | 'loan-end'
  | 'custom'
  | 'first-gap'
  | 'minimum-cash'
  | 'end';

export interface MilestoneMarker {
  id: string;
  month: MonthIndex;
  year: number;
  age: number | null;
  label: string;
  kind: MilestoneKind;
  source: 'user' | 'system';
  targetSection?: string;
  prominence: number;
  status: 'past' | 'current' | 'future' | 'risk';
}

export interface MilestoneGroup {
  year: number;
  month: MonthIndex;
  markers: MilestoneMarker[];
  prominence: number;
  hasRisk: boolean;
}

function ageAt(plan: LifePlan, month: MonthIndex) {
  const birth = plan.members.find(
    (member) => member.id === plan.primaryMemberId
  )?.birthMonth;
  return birth === undefined ? null : Math.floor((month - birth) / 12);
}

function kindForTimelineEvent(event: TimelineEvent): MilestoneKind {
  if (event.kind === 'start') return 'start';
  if (event.kind === 'end') return 'end';
  if (event.kind === 'retirement') return 'retirement';
  if (event.kind === 'loan_end') return 'loan-end';
  if (event.kind === 'relocation') return 'relocation';
  if (event.target === 'career') return 'career';
  if (event.target === 'partner') return 'partner';
  if (event.target === 'child') return 'child';
  if (event.target === 'housing') return 'housing';
  if (event.target === 'parents') return 'parents';
  return 'custom';
}

function labelForTimelineEvent(event: TimelineEvent) {
  if (event.name) return event.name;
  if (event.kind === 'start') return 'start';
  if (event.kind === 'end') return 'end';
  if (event.kind === 'retirement') return 'retirement';
  if (event.kind === 'loan_end') return 'loan-end';
  return 'event';
}

function statusFor(
  plan: LifePlan,
  month: MonthIndex,
  source: MilestoneMarker['source'],
  kind: MilestoneKind
): MilestoneMarker['status'] {
  if (source === 'system' && kind === 'first-gap') return 'risk';
  if (month < plan.baseMonth) return 'past';
  if (month === plan.baseMonth) return 'current';
  return 'future';
}

function fromTimelineEvent(
  plan: LifePlan,
  event: TimelineEvent
): MilestoneMarker {
  const kind = kindForTimelineEvent(event);
  return {
    id: `plan:${event.id}`,
    month: event.month,
    year: monthParts(event.month).year,
    age: ageAt(plan, event.month),
    label: labelForTimelineEvent(event),
    kind,
    source: 'user',
    targetSection: event.target,
    prominence: event.prominence,
    status: statusFor(plan, event.month, 'user', kind),
  };
}

function systemMarker(
  plan: LifePlan,
  id: string,
  month: MonthIndex,
  kind: 'first-gap' | 'minimum-cash',
  prominence: number
): MilestoneMarker {
  return {
    id,
    month,
    year: monthParts(month).year,
    age: ageAt(plan, month),
    label: kind,
    kind,
    source: 'system',
    prominence,
    status: statusFor(plan, month, 'system', kind),
  };
}

export function buildMilestones(
  plan: LifePlan,
  result: MonthlyCalculationResult
): MilestoneMarker[] {
  const facts = extractPlanFacts(plan, result);
  const markers = lifeTimeline(plan).map((event) =>
    fromTimelineEvent(plan, event)
  );
  if (facts.firstGapMonth !== null) {
    markers.push(
      systemMarker(
        plan,
        'system:first-gap',
        facts.firstGapMonth,
        'first-gap',
        120
      )
    );
  }
  markers.push(
    systemMarker(
      plan,
      'system:minimum-cash',
      facts.minimumMonth,
      'minimum-cash',
      110
    )
  );

  const unique = new Map<string, MilestoneMarker>();
  for (const marker of markers) unique.set(marker.id, marker);
  return [...unique.values()].sort(
    (a, b) =>
      a.month - b.month ||
      b.prominence - a.prominence ||
      a.id.localeCompare(b.id)
  );
}

export function groupMilestonesByYear(
  milestones: readonly MilestoneMarker[]
): MilestoneGroup[] {
  const groups = new Map<number, MilestoneMarker[]>();
  for (const marker of milestones) {
    groups.set(marker.year, [...(groups.get(marker.year) ?? []), marker]);
  }
  return [...groups.entries()]
    .map(([year, markers]) => {
      const sorted = [...markers].sort(
        (a, b) =>
          a.month - b.month ||
          b.prominence - a.prominence ||
          a.id.localeCompare(b.id)
      );
      return {
        year,
        month: sorted[0].month,
        markers: sorted,
        prominence: Math.max(...sorted.map((marker) => marker.prominence)),
        hasRisk: sorted.some((marker) => marker.status === 'risk'),
      };
    })
    .sort((a, b) => a.year - b.year);
}

export function selectPrimaryMilestones(
  milestones: readonly MilestoneMarker[],
  maximum = 7
): MilestoneMarker[] {
  if (!Number.isSafeInteger(maximum) || maximum < 0)
    throw new Error('Invalid milestone limit');
  if (maximum === 0) return [];
  const essentialKinds = new Set<MilestoneKind>([
    'first-gap',
    'minimum-cash',
    'retirement',
  ]);
  const essential = milestones.filter((marker) =>
    essentialKinds.has(marker.kind)
  );
  const remaining = milestones
    .filter((marker) => !essentialKinds.has(marker.kind))
    .sort(
      (a, b) =>
        b.prominence - a.prominence ||
        a.month - b.month ||
        a.id.localeCompare(b.id)
    );
  return [...essential, ...remaining]
    .slice(0, maximum)
    .sort((a, b) => a.month - b.month || a.id.localeCompare(b.id));
}
