import { lifeStageExpenses } from '../../analysis/life-stage-expenses';
import type { MonthlyCalculationResult } from '../../calculation';
import { moneyFormatter } from '../plan/fields';
import type { WorkspaceCopy } from '../workspace-types';

const colors = {
  living: '#4874B8',
  housing: '#BE6742',
  child: '#3C8A69',
  parent: '#B48A28',
  other: '#747B8B',
  retirement: '#AC6084',
};

export function LifeStageExpenses({
  result,
  copy,
  locale,
}: {
  result: MonthlyCalculationResult;
  copy: WorkspaceCopy;
  locale: string;
}) {
  const stages = lifeStageExpenses(result);
  const money = moneyFormatter(locale);
  const eventName = (stage: (typeof stages)[number]) =>
    stage.event?.kind === 'retirement'
      ? copy.plan.sections.retirement
      : stage.event?.name || copy.stages.start;
  const phaseTitle = (stage: (typeof stages)[number], index: number) => {
    const next = stages[index + 1];
    if (index === 0 && next?.event?.kind === 'retirement')
      return copy.stages.career_transition;
    if (stage.event?.kind === 'retirement') return copy.stages.retirement_life;
    if (index === 0)
      return next
        ? `${eventName(next)}${copy.stages.before}`
        : copy.stages.current;
    return `${eventName(stage)}${copy.stages.after}`;
  };
  const ageRange = (stage: (typeof stages)[number]) => {
    if (stage.ageStart === null || stage.ageEnd === null)
      return copy.stages.months.replace('{count}', String(stage.months));
    return stage.ageStart === stage.ageEnd
      ? `${stage.ageStart} ${copy.common.age}`
      : `${stage.ageStart}–${stage.ageEnd} ${copy.common.age}`;
  };
  return (
    <section aria-labelledby="life-stage-expenses-heading">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2
            id="life-stage-expenses-heading"
            className="text-lg font-semibold"
          >
            {copy.stages.title}
          </h2>
          <p className="text-muted-foreground mt-1 max-w-[70ch] text-sm">
            {copy.stages.hint}
          </p>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {Object.entries(copy.charts.groups).map(([key, label]) => (
            <span key={key} className="inline-flex items-center gap-1.5">
              <span
                className="size-2.5 rounded-sm"
                style={{ background: colors[key as keyof typeof colors] }}
                aria-hidden="true"
              />
              {String(label)}
            </span>
          ))}
        </div>
      </div>
      <ol className="mt-4 grid gap-3">
        {stages.map((stage, index) => {
          const dominantAmount = stage.dominant
            ? stage.groups[stage.dominant]
            : 0;
          const dominantPercent = stage.totalCents
            ? Math.round((dominantAmount / stage.totalCents) * 100)
            : 0;
          return (
            <li
              key={stage.id}
              className="bg-background grid min-w-0 gap-4 rounded-xl px-4 py-4 shadow-[0_12px_30px_-28px_rgba(15,23,42,0.7)] 2xl:grid-cols-[minmax(9rem,1.1fr)_minmax(16rem,2fr)_minmax(17rem,auto)] 2xl:items-center"
            >
              <div>
                <h3 className="font-medium">{phaseTitle(stage, index)}</h3>
                <p className="text-muted-foreground mt-0.5 text-xs tabular-nums">
                  {ageRange(stage)} ·{' '}
                  {copy.stages.duration.replace(
                    '{years}',
                    new Intl.NumberFormat(locale, {
                      maximumFractionDigits: 1,
                    }).format(stage.months / 12)
                  )}
                </p>
                {index === 0 && stage.event && (
                  <p className="text-muted-foreground mt-1 text-xs">
                    {copy.stages.from.replace('{event}', eventName(stage))}
                  </p>
                )}
              </div>
              <div>
                <div
                  className="bg-muted flex h-3 overflow-hidden rounded-sm"
                  role="img"
                  aria-label={copy.stages.structure.replace(
                    '{stage}',
                    phaseTitle(stage, index)
                  )}
                >
                  {Object.entries(stage.groups).map(([group, amount]) =>
                    amount > 0 ? (
                      <span
                        key={group}
                        style={{
                          width: `${(amount / stage.totalCents) * 100}%`,
                          background: colors[group as keyof typeof colors],
                        }}
                      />
                    ) : null
                  )}
                </div>
                <p className="text-muted-foreground mt-2 text-xs">
                  {stage.dominant
                    ? `${copy.charts.groups[stage.dominant]} ${dominantPercent}%`
                    : copy.stages.no_expense}
                </p>
              </div>
              <dl className="grid min-w-0 grid-cols-3 gap-3 text-left tabular-nums 2xl:text-right">
                <div className="min-w-0">
                  <dt className="text-muted-foreground text-xs">
                    {copy.stages.monthly}
                  </dt>
                  <dd className="mt-1 text-sm font-semibold break-words">
                    {money(stage.monthlyAverageCents)}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-muted-foreground text-xs">
                    {copy.stages.annual}
                  </dt>
                  <dd className="mt-1 text-sm font-semibold break-words">
                    {money(stage.annualAverageCents)}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-muted-foreground text-xs">
                    {copy.stages.total}
                  </dt>
                  <dd className="mt-1 text-sm font-semibold break-words">
                    {money(stage.totalCents)}
                  </dd>
                </div>
              </dl>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
