'use client';

import type { RefObject } from 'react';
import { monthParts, type MonthIndex } from '@/features/life-ledger/domain';
import { ArrowRight, ShieldCheck } from 'lucide-react';

import { cn } from '@/shared/lib/utils';

import type { MonthlyCalculationResult } from '../calculation';
import { BaselineMiniChart } from './baseline-mini-chart';
import type { PersonalBaselineInput } from './personal-baseline';
import type { PersonalBaselineCalculatorConfig } from './personal-baseline-form';

export function PersonalBaselineResult({
  config,
  input,
  result,
  isDirty,
  onContinue,
  sectionRef,
}: {
  config: PersonalBaselineCalculatorConfig;
  input: PersonalBaselineInput;
  result: MonthlyCalculationResult;
  isDirty: boolean;
  onContinue: () => void;
  sectionRef: RefObject<HTMLElement | null>;
}) {
  const locale = config.locale || 'zh-CN';
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  const formatMoney = (cents: number) =>
    `${number.format(Math.round(cents / 100))} ${config.units.currency}`;
  const summary = result.summary;
  const endingPositive = summary.endingAvailableCents >= 0;
  const conclusion = !summary.hasAnyGap
    ? config.p2_result_ok
    : endingPositive
      ? config.p2_result_recovered
      : config.p2_result_gap;
  const firstGapRow = summary.firstGapMonth
    ? result.monthly.find((row) => row.month === summary.firstGapMonth)
    : undefined;
  const firstGap = summary.firstGapMonth
    ? formatAgeAndMonth(
        firstGapRow?.age ?? null,
        summary.firstGapMonth,
        locale,
        config.units.age
      )
    : config.p2_no_gap;

  const metrics = [
    { label: config.p2_first_gap, value: firstGap },
    {
      label: config.p2_ending,
      value: formatMoney(summary.endingAvailableCents),
    },
  ];

  return (
    <section
      ref={sectionRef}
      tabIndex={-1}
      className="border-border bg-muted/35 -mx-5 mt-4 scroll-mt-24 border-y px-5 py-6 focus:outline-none sm:-mx-6 sm:px-6"
      aria-live="polite"
      aria-labelledby={`${config.id || 'calculator'}-result-title`}
    >
      <div className="flex items-start gap-3">
        <span className="bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-xl">
          <ShieldCheck className="size-4.5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-muted-foreground text-xs font-medium">
            {config.p2_result_label}
          </p>
          <h3
            id={`${config.id || 'calculator'}-result-title`}
            className="text-foreground mt-1 max-w-[54ch] text-base leading-relaxed font-semibold"
          >
            {conclusion}
          </h3>
        </div>
      </div>

      <dl className="border-border mt-6 grid border-y sm:grid-cols-2">
        {metrics.map((metric, index) => (
          <div
            key={metric.label}
            className={cn(
              'py-4 sm:px-4',
              index > 0 && 'border-border max-sm:border-t sm:border-l',
              index === 0 && 'sm:pl-0',
              index === metrics.length - 1 && 'sm:pr-0'
            )}
          >
            <dt className="text-muted-foreground text-[11px] font-medium">
              {metric.label}
            </dt>
            <dd className="text-foreground mt-1.5 text-sm font-semibold tabular-nums">
              {metric.value}
            </dd>
          </div>
        ))}
      </dl>

      <BaselineMiniChart config={config} result={result} />

      <p className="text-muted-foreground mt-4 text-xs leading-relaxed">
        {interpolate(config.p2_timeline_summary, {
          age: input.currentAge,
          retireAge: input.retirementAge,
          endAge: input.endAge,
        })}
      </p>

      <details className="border-border mt-4 border-t pt-4 text-xs">
        <summary className="text-foreground hover:text-primary cursor-pointer font-medium focus-visible:outline-none">
          {config.assumptions_title}
        </summary>
        <p className="text-muted-foreground mt-2 max-w-[70ch] leading-relaxed">
          {config.p2_assumptions}
        </p>
      </details>

      <div className="border-border mt-5 border-t pt-5">
        <p className="text-muted-foreground max-w-[70ch] text-xs leading-relaxed">
          {config.p2_estimate_note}
        </p>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h4 className="text-foreground text-sm font-semibold">
              {config.continue_title}
            </h4>
            <p className="text-muted-foreground mt-1 max-w-[50ch] text-xs leading-relaxed">
              {config.continue_description}
            </p>
          </div>
          <button
            type="button"
            onClick={onContinue}
            disabled={isDirty}
            className="bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-primary/30 inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition-colors focus-visible:ring-4 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-45"
          >
            {config.continue_button}
            <ArrowRight className="size-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </section>
  );
}

function interpolate(
  template: string,
  values: Record<string, string | number>
) {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.replaceAll(`{${key}}`, String(value)),
    template
  );
}

function formatAgeAndMonth(
  age: number | null,
  month: MonthIndex,
  locale: string,
  ageUnit: string
) {
  const parts = monthParts(month);
  const date = locale.startsWith('zh')
    ? `${parts.year} 年 ${parts.month} 月`
    : `${parts.year}-${String(parts.month).padStart(2, '0')}`;
  return age === null ? date : `${age} ${ageUnit} · ${date}`;
}
