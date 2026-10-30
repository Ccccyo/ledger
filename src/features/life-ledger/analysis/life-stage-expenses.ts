import type { MonthlyCalculationResult } from '../calculation';
import type { CashFlowCategory } from '../domain';
import { primaryTimelineEvents, type TimelineEvent } from './life-timeline';

export const STAGE_EXPENSE_GROUPS = [
  'living',
  'housing',
  'child',
  'parent',
  'other',
  'retirement',
] as const;
export type StageExpenseGroup = (typeof STAGE_EXPENSE_GROUPS)[number];

const groupFor = (category: CashFlowCategory): StageExpenseGroup =>
  [
    'living',
    'self_travel',
    'self_hobbies',
    'self_learning',
    'self_wellness',
    'self_social',
    'healthcare',
    'tax',
  ].includes(category)
    ? 'living'
    : category === 'housing'
      ? 'housing'
      : category === 'child'
        ? 'child'
        : category === 'parent'
          ? 'parent'
          : category === 'retirement'
            ? 'retirement'
            : 'other';

export interface LifeStageExpense {
  id: string;
  event: TimelineEvent | null;
  startMonth: number;
  endMonthExclusive: number;
  ageStart: number | null;
  ageEnd: number | null;
  months: number;
  totalCents: number;
  monthlyAverageCents: number;
  annualAverageCents: number;
  groups: Record<StageExpenseGroup, number>;
  dominant: StageExpenseGroup | null;
}

export function lifeStageExpenses(
  result: MonthlyCalculationResult
): LifeStageExpense[] {
  const base = result.input.baseMonth;
  const milestones = primaryTimelineEvents(result.input).filter(
    (event) =>
      event.month >= base && event.month < result.input.endMonthExclusive
  );
  const starts = new Map<number, TimelineEvent | null>([[base, null]]);
  for (const event of milestones) starts.set(event.month, event);
  const points = [...starts.entries()].sort(([a], [b]) => a - b);
  return points.flatMap(([startMonth, event], index) => {
    const endMonthExclusive =
      points[index + 1]?.[0] ?? result.input.endMonthExclusive;
    const rows = result.monthly.filter(
      (row) => row.month >= startMonth && row.month < endMonthExclusive
    );
    if (rows.length === 0) return [];
    const groups = Object.fromEntries(
      STAGE_EXPENSE_GROUPS.map((group) => [group, 0])
    ) as Record<StageExpenseGroup, number>;
    for (const row of rows)
      for (const [category, amount] of Object.entries(row.expenseByCategory))
        groups[groupFor(category as CashFlowCategory)] += amount ?? 0;
    const totalCents = rows.reduce((sum, row) => sum + row.expenseCents, 0);
    const dominant =
      STAGE_EXPENSE_GROUPS.filter((group) => groups[group] > 0).sort(
        (a, b) => groups[b] - groups[a]
      )[0] ?? null;
    const monthlyAverageCents = Math.round(totalCents / rows.length);
    return [
      {
        id: `${startMonth}:${event?.id ?? 'start'}`,
        event,
        startMonth,
        endMonthExclusive,
        ageStart: rows[0].age,
        ageEnd: rows.at(-1)?.age ?? null,
        months: rows.length,
        totalCents,
        monthlyAverageCents,
        annualAverageCents: monthlyAverageCents * 12,
        groups,
        dominant,
      },
    ];
  });
}
