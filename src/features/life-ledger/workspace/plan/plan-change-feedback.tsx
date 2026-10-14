import type { ResultChange } from '../../analysis/digest-result';
import { formatMonth } from '../../domain';
import type { WorkspaceCopy } from '../workspace-types';
import { moneyFormatter } from './fields';

export function PlanChangeFeedback({
  change,
  copy,
  locale,
  pending,
  compact = false,
}: {
  change: ResultChange | null;
  copy: WorkspaceCopy;
  locale: string;
  pending: boolean;
  compact?: boolean;
}) {
  if (!change || pending) return null;
  const money = moneyFormatter(locale);
  const signed = (value: number) => `${value > 0 ? '+' : ''}${money(value)}`;
  const gap = (month: ResultChange['before']['firstGapMonth']) =>
    month === null ? copy.overview.no_gap : formatMonth(month);
  const unchanged =
    change.endingDeltaCents === 0 &&
    change.minimumDeltaCents === 0 &&
    change.before.firstGapMonth === change.after.firstGapMonth;
  if (compact)
    return (
      <p
        role="status"
        className="text-muted-foreground border-border border-t pt-4 text-sm leading-relaxed"
      >
        {unchanged
          ? copy.feedback.unchanged
          : `${copy.feedback.ending} ${signed(change.endingDeltaCents)}`}
        {change.before.firstGapMonth !== change.after.firstGapMonth && (
          <span className="block">
            {copy.overview.first_gap}：{gap(change.before.firstGapMonth)} →{' '}
            {gap(change.after.firstGapMonth)}
          </span>
        )}
      </p>
    );
  return (
    <aside role="status" className="border-border mb-7 border-b pb-5 text-sm">
      <p className="font-medium">
        {unchanged ? copy.feedback.unchanged : copy.feedback.title}
      </p>
      {!unchanged && (
        <dl className="mt-3 grid gap-3 sm:grid-cols-3">
          <div>
            <dt className="text-muted-foreground text-xs">
              {copy.overview.first_gap}
            </dt>
            <dd className="mt-1 tabular-nums">
              {gap(change.before.firstGapMonth)} →{' '}
              {gap(change.after.firstGapMonth)}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">
              {copy.feedback.minimum}
            </dt>
            <dd className="mt-1 tabular-nums">
              {signed(change.minimumDeltaCents)}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">
              {copy.feedback.ending}
            </dt>
            <dd className="mt-1 tabular-nums">
              {signed(change.endingDeltaCents)}
            </dd>
          </div>
        </dl>
      )}
    </aside>
  );
}
