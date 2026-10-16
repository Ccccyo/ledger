'use client';

import { useId } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import {
  balanceChartScale,
  balanceZeroOffset,
} from '../analysis/balance-chart-scale';
import type { MonthlyCalculationResult } from '../calculation';
import { monthParts } from '../domain';
import type { PersonalBaselineCalculatorConfig } from './personal-baseline-form';

export function BaselineMiniChart({
  config,
  result,
}: {
  config: PersonalBaselineCalculatorConfig;
  result: MonthlyCalculationResult;
}) {
  const id = useId().replaceAll(':', '');
  const locale = config.locale || 'zh-CN';
  const rows = result.annual.map((row) => ({
    year: row.year,
    age: row.ageEnd,
    available: row.closingAvailableCents,
  }));
  const values = rows.map((row) => row.available);
  const { domain, ticks } = balanceChartScale(values);
  const zero = balanceZeroOffset(values);
  const retirementYear = monthParts(result.input.retirementMonth).year;
  const firstGap =
    result.summary.firstGapYear === null
      ? null
      : (rows.find((row) => row.year === result.summary.firstGapYear) ?? null);
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const fullNumber = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 0,
  });
  const money = (cents: number) =>
    `${fullNumber.format(Math.round(cents / 100))} ${config.units.currency}`;
  const compactMoney = (cents: number) => {
    const yuan = cents / 100;
    if (locale.startsWith('zh')) {
      return `${number.format(yuan / 10_000)}万`;
    }
    if (Math.abs(yuan) >= 1_000_000)
      return `${number.format(yuan / 1_000_000)}m`;
    if (Math.abs(yuan) >= 1_000) return `${number.format(yuan / 1_000)}k`;
    return number.format(yuan);
  };
  const ageLabel = (year: number) => {
    const age = rows.find((row) => row.year === year)?.age;
    return age === null || age === undefined
      ? String(year)
      : locale.startsWith('zh')
        ? `${age}岁`
        : `Age ${age}`;
  };
  const visibleYears = [
    rows[0]?.year,
    retirementYear,
    rows.at(-1)?.year,
  ].filter(
    (year, index, all): year is number =>
      year !== undefined && all.indexOf(year) === index
  );

  if (rows.length === 0) return null;

  return (
    <section
      className="border-border mt-5 border-t pt-5"
      aria-labelledby={`${id}-title`}
    >
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h4
            id={`${id}-title`}
            className="text-foreground text-sm font-semibold"
          >
            {config.p3_chart_title}
          </h4>
          <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
            {config.p3_chart_hint}
          </p>
        </div>
        <span className="text-muted-foreground text-[11px]">
          {config.p3_chart_available}
        </span>
      </div>

      <div className="mt-3 h-52 sm:h-56" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={rows}
            margin={{ top: 22, right: 12, bottom: 4, left: 0 }}
          >
            <defs>
              <linearGradient id={`${id}-area`} x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset={zero}
                  stopColor="var(--primary)"
                  stopOpacity={0.16}
                />
                <stop offset={zero} stopColor="#b7791f" stopOpacity={0.16} />
              </linearGradient>
              <linearGradient id={`${id}-line`} x1="0" y1="0" x2="0" y2="1">
                <stop offset={zero} stopColor="var(--primary)" />
                <stop offset={zero} stopColor="#b7791f" />
              </linearGradient>
            </defs>
            <CartesianGrid
              vertical={false}
              stroke="var(--border)"
              strokeDasharray="3 5"
            />
            <XAxis
              dataKey="year"
              type="number"
              domain={['dataMin', 'dataMax']}
              ticks={visibleYears}
              tickFormatter={ageLabel}
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
              dy={7}
            />
            <YAxis
              domain={domain}
              ticks={ticks}
              tickFormatter={compactMoney}
              tickLine={false}
              axisLine={false}
              width={54}
              tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
            />
            <Tooltip
              content={({ active, payload }) => {
                const row = payload?.[0]?.payload as
                  | (typeof rows)[number]
                  | undefined;
                if (!active || !row) return null;
                return (
                  <div className="border-border bg-background rounded-lg border px-3 py-2 text-xs shadow-sm">
                    <p className="font-medium">
                      {row.year} · {ageLabel(row.year)}
                    </p>
                    <p className="text-muted-foreground mt-1 tabular-nums">
                      {money(row.available)}
                    </p>
                  </div>
                );
              }}
              cursor={{
                stroke: 'var(--muted-foreground)',
                strokeDasharray: '3 3',
              }}
            />
            <ReferenceLine
              y={0}
              stroke="var(--muted-foreground)"
              strokeWidth={1}
            />
            <ReferenceLine
              x={retirementYear}
              stroke="var(--muted-foreground)"
              strokeDasharray="4 4"
              label={{
                value: config.p3_chart_retirement,
                position: 'insideTopRight',
                fontSize: 10,
                fill: 'var(--muted-foreground)',
              }}
            />
            {firstGap && (
              <ReferenceDot
                x={firstGap.year}
                y={firstGap.available}
                r={4.5}
                fill="#b7791f"
                stroke="var(--background)"
                strokeWidth={2}
              />
            )}
            <Area
              type="monotone"
              dataKey="available"
              baseValue={0}
              stroke={`url(#${id}-line)`}
              strokeWidth={2.4}
              fill={`url(#${id}-area)`}
              dot={false}
              activeDot={{ r: 4, stroke: 'var(--background)', strokeWidth: 2 }}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2 text-[11px]">
        <span className="inline-flex items-center gap-2">
          <span className="bg-primary h-0.5 w-5" />
          {config.p3_chart_available}
        </span>
        <span className="text-muted-foreground inline-flex items-center gap-2">
          <span className="h-4 border-l border-dashed border-current" />
          {config.p3_chart_retirement}
        </span>
        {firstGap && (
          <span className="inline-flex items-center gap-2 text-amber-800 dark:text-amber-300">
            <span className="size-2 rounded-full bg-[#b7791f]" />
            {config.p3_chart_first_gap}
          </span>
        )}
      </div>

      <details className="border-border mt-4 border-t pt-3 text-xs">
        <summary className="text-muted-foreground hover:text-foreground cursor-pointer focus-visible:outline-none">
          {config.p3_chart_table}
        </summary>
        <div className="mt-3 max-h-52 overflow-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr>
                <th scope="col" className="pb-2 font-medium">
                  {config.p3_chart_year}
                </th>
                <th scope="col" className="pb-2 text-right font-medium">
                  {config.p3_chart_available}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.year} className="border-border border-t">
                  <th scope="row" className="py-2 font-normal">
                    {row.year} · {ageLabel(row.year)}
                  </th>
                  <td className="py-2 text-right tabular-nums">
                    {money(row.available)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
