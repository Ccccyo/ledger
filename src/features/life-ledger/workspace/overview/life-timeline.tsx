import {
  lifeTimeline,
  primaryTimelineEvents,
} from '../../analysis/life-timeline';
import { formatMonth, type LifePlan } from '../../domain';
import type { WorkspaceCopy } from '../workspace-types';

export function LifeTimeline({
  plan,
  copy,
  onNavigate,
}: {
  plan: LifePlan;
  copy: WorkspaceCopy;
  onNavigate: (section: string) => void;
}) {
  const events = lifeTimeline(plan),
    primary = primaryTimelineEvents(plan),
    c = copy.timeline;
  const birth = plan.members.find(
    (m) => m.id === plan.primaryMemberId
  )?.birthMonth;
  const label = (month: number) =>
    birth === undefined
      ? formatMonth(month as typeof plan.baseMonth)
      : `${Math.floor((month - birth) / 12)} ${copy.common.age}`;
  const span = plan.endMonthExclusive - plan.baseMonth;
  const working = ((plan.retirementMonth - plan.baseMonth) / span) * 100;
  const custom = events.filter(
    (e) => !['start', 'retirement', 'end'].includes(e.kind)
  );
  const name = (e: (typeof events)[number]) =>
    e.kind === 'relocation'
      ? copy.relocation.timeline.replace('{city}', e.name)
      : e.kind === 'event'
        ? e.name
        : e.kind === 'loan_end'
          ? `${e.name} · ${c.loan_end}`
          : e.kind === 'retirement'
            ? copy.plan.sections.retirement
            : c[e.kind];
  return (
    <section
      aria-labelledby="life-timeline-heading"
      className="bg-muted/30 rounded-xl px-4 py-4"
    >
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="life-timeline-heading" className="text-base font-semibold">
          {c.title}
        </h2>
        <span className="text-muted-foreground text-xs">
          {formatMonth(plan.baseMonth)} —{' '}
          {formatMonth((plan.endMonthExclusive - 1) as typeof plan.baseMonth)}
        </span>
      </div>
      <div
        className="relative flex h-9 overflow-hidden rounded-md text-xs"
        aria-hidden="true"
      >
        <div
          style={{ width: `${working}%` }}
          className="bg-primary/15 flex items-center justify-center font-medium"
        >
          {c.working}
        </div>
        <div className="bg-muted flex flex-1 items-center justify-center">
          {c.retired}
        </div>
        {primary
          .filter((event) => event.kind !== 'retirement')
          .map((e) => (
            <span
              key={e.id}
              title={`${formatMonth(e.month)} ${name(e)}`}
              className="bg-foreground/40 absolute inset-y-0 w-px"
              style={{ left: `${((e.month - plan.baseMonth) / span) * 100}%` }}
            />
          ))}
      </div>
      <div className="relative mt-1 flex justify-between text-xs tabular-nums">
        <span>{label(plan.baseMonth)}</span>
        <span
          className="absolute -translate-x-1/2"
          style={{ left: `${working}%` }}
        >
          {label(plan.retirementMonth)}
        </span>
        <span>{label(plan.endMonthExclusive - 1)}</span>
      </div>
      {primary.length === 1 && (
        <p className="text-muted-foreground mt-3 text-xs">{c.empty}</p>
      )}
      {primary.length > 0 && (
        <ol className="mt-2 flex flex-wrap gap-x-5 gap-y-0">
          {primary.map((e) => (
            <li key={e.id}>
              <button
                type="button"
                className="hover:text-primary focus-visible:ring-primary/30 min-h-11 rounded text-left text-xs focus-visible:ring-4"
                onClick={() => onNavigate(e.target)}
              >
                <span className="mr-2 font-semibold tabular-nums">
                  {label(e.month)}
                </span>
                {name(e)}
              </button>
            </li>
          ))}
        </ol>
      )}
      <details className="mt-1">
        <summary className="text-muted-foreground cursor-pointer py-1 text-xs">
          {c.more} · {events.length}
        </summary>
        <ol className="mt-2 grid max-h-44 gap-x-5 gap-y-1 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
          {events.map((e) => (
            <li key={e.id}>
              <button
                type="button"
                className="hover:bg-muted focus-visible:ring-primary/30 flex min-h-11 w-full items-start gap-3 rounded-md px-2 py-2 text-left focus-visible:ring-4"
                onClick={() => onNavigate(e.target)}
              >
                <time
                  className="text-primary shrink-0 text-xs tabular-nums"
                  dateTime={formatMonth(e.month)}
                >
                  {formatMonth(e.month)}
                </time>
                <span className="min-w-0 text-xs break-words">
                  {name(e)}
                  {e.end !== undefined && (
                    <span className="text-muted-foreground block">
                      {c.end_event} {formatMonth(e.end)}
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ol>
      </details>
    </section>
  );
}
