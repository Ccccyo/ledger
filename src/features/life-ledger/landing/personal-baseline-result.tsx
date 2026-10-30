'use client';

import type { RefObject } from 'react';
import { monthParts, type MonthIndex } from '@/features/life-ledger/domain';
import { ArrowRight } from 'lucide-react';

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
      className="border-border/70 -mx-5 mt-5 scroll-mt-24 border-t px-5 pt-7 focus:outline-none sm:-mx-7 sm:px-7"
      aria-live="polite"
      aria-labelledby={`${config.id || 'calculator'}-result-title`}
    >
      <div>
        <p className="text-primary text-xs font-semibold">
          {config.p2_result_label}
        </p>
        <h3
          id={`${config.id || 'calculator'}-result-title`}
          className="text-foreground mt-1.5 max-w-[52ch] text-lg leading-snug font-semibold tracking-tight"
        >
          {conclusion}
        </h3>
      </div>

      <dl className="mt-5 grid gap-3 sm:grid-cols-2">
        {metrics.map((metric) => (
          <div key={metric.label} className="bg-muted/45 rounded-2xl p-4">
            <dt className="text-muted-foreground text-[11px] font-medium">
              {metric.label}
            </dt>
            <dd className="text-foreground mt-2 text-base font-semibold tabular-nums">
              {metric.value}
            </dd>
          </div>
        ))}
      </dl>

      <BaselineMiniChart config={config} result={result} />

      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-muted-foreground text-xs leading-relaxed">
          {interpolate(config.p2_timeline_summary, {
            age: input.currentAge,
            retireAge: input.retirementAge,
            endAge: input.endAge,
          })}
        </p>
        <details className="text-xs sm:text-right">
          <summary className="text-foreground hover:text-primary cursor-pointer font-medium focus-visible:outline-none">
            {config.assumptions_title}
          </summary>
          <p className="text-muted-foreground mt-2 max-w-[62ch] text-left leading-relaxed sm:text-right">
            {config.p2_assumptions}
          </p>
        </details>
      </div>

      <div className="bg-primary/[0.06] mt-6 rounded-2xl p-4 sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h4 className="text-foreground text-sm font-semibold">
              {config.continue_title}
            </h4>
            <p className="text-muted-foreground mt-1 max-w-[50ch] text-xs leading-relaxed">
              {config.continue_description}
            </p>
          </div>
          <button
            id={`${config.id || 'calculator'}-continue`}
            type="button"
            onClick={onContinue}
            disabled={isDirty}
            className="bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-primary/30 inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition-[background-color,transform] focus-visible:ring-4 focus-visible:outline-none active:translate-y-px disabled:cursor-not-allowed disabled:opacity-45"
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
