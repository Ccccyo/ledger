import { activeFlows } from '../../analysis/extract-life-trajectory';
import { formatMonth, type LifePlan } from '../../domain';
import type { WorkspaceCopy } from '../workspace-types';
import { salaryGrowthBps } from './career-mutations';
import { belongsToStage } from './event-mutations';
import { moneyFormatter } from './fields';
import { findBucket } from './plan-mutations';
import type { PlanSectionId } from './types';

export function sectionSummary(
  id: PlanSectionId,
  plan: LifePlan,
  copy: WorkspaceCopy,
  locale: string
) {
  const money = moneyFormatter(locale);
  if (id === 'basics')
    return `${formatMonth(plan.baseMonth)} — ${formatMonth(plan.endMonthExclusive)}`;
  if (id === 'assets')
    return `${copy.plan.available_cash} ${money(plan.assets.filter((a) => a.liquid).reduce((sum, a) => sum + a.openingBalanceCents, 0))}`;
  if (id === 'income' || id === 'living' || id === 'retirement') {
    const bucket = findBucket(
      plan,
      id === 'income'
        ? 'income'
        : id === 'living'
          ? 'working-expenses'
          : 'retirement-expenses'
    );
    return `${money(bucket?.summary?.amountCents ?? 0)}${copy.common.per_month}`;
  }
  if (id === 'advanced')
    return `${copy.editor.gap_cost} ${plan.assumptions.annualCashGapCostBps / 100}%`;
  if (id === 'investment') {
    const investments = plan.metadata.investmentScenarios ?? [];
    return investments.length
      ? copy.editor.count.replace('{count}', String(investments.length))
      : copy.trajectory.status.missing;
  }
  if (id === 'career') {
    const growth = salaryGrowthBps(plan);
    const changes = plan.standaloneCashFlows.filter(
      (f) =>
        f.ownerId === plan.primaryMemberId &&
        ['salary', 'side_income'].includes(f.category)
    );
    return growth !== 0
      ? `${copy.career.growth} ${growth / 100}%${changes.length ? ` · ${copy.editor.count.replace('{count}', String(changes.length))}` : ''}`
      : changes.length
        ? copy.editor.count.replace('{count}', String(changes.length))
        : copy.trajectory.status.missing;
  }
  if (
    id === 'housing' &&
    plan.assets.some((a) => a.kind === 'property' && a.openingBalanceCents > 0)
  )
    return copy.flow.property_included;
  const flows = (
    id === 'events' ? plan.standaloneCashFlows : activeFlows(plan)
  ).filter(
    (f) =>
      belongsToStage(plan, f, id) &&
      f.amountCents > 0 &&
      f.confirmation === 'confirmed' &&
      f.startMonth < plan.endMonthExclusive &&
      f.endMonthExclusive > plan.baseMonth
  );
  if (!flows.length)
    return id !== 'events' && plan.metadata.excludedLifeStages?.includes(id)
      ? copy.trajectory.status['not-applicable']
      : copy.trajectory.status.missing;
  const first = flows.toSorted((a, b) => a.startMonth - b.startMonth)[0];
  return `${formatMonth(first.startMonth)} · ${first.name} · ${money(first.amountCents)} · ${copy.editor[first.frequency.kind]}${flows.length > 1 ? ` · ${copy.editor.count.replace('{count}', String(flows.length))}` : ''}`;
}
