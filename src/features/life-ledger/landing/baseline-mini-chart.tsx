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
  const { domain } = balanceChartScale(values);
  const balanceTicks = [...new Set([domain[0], 0, domain[1]])];
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
    <section className="mt-6" aria-labelledby={`${id}-title`}>
      <div>
        <h4
          id={`${id}-title`}
          className="text-foreground text-sm font-semibold"
        >
          {config.p3_chart_title}
        </h4>
        <p className="text-muted-foreground mt-1 text-[11px] leading-relaxed">
          {config.p3_chart_hint}
        </p>
      </div>

      <div
        className="bg-background mt-3 h-48 rounded-2xl px-1.5 pt-2 shadow-[0_18px_45px_-40px_rgba(15,23,42,0.7)] sm:h-52"
        aria-hidden="true"
      >
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={rows}
            margin={{ top: 18, right: 10, bottom: 4, left: 0 }}
          >
            <defs>
              <linearGradient id={`${id}-area`} x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset={0}
                  stopColor="var(--primary)"
                  stopOpacity={0.22}
                />
                <stop
                  offset={zero}
                  stopColor="var(--primary)"
                  stopOpacity={0.04}
                />
                <stop offset={zero} stopColor="#b7791f" stopOpacity={0.06} />
                <stop offset={1} stopColor="#b7791f" stopOpacity={0.18} />
              </linearGradient>
              <linearGradient id={`${id}-line`} x1="0" y1="0" x2="0" y2="1">
                <stop offset={zero} stopColor="var(--primary)" />
                <stop offset={zero} stopColor="#b7791f" />
              </linearGradient>
            </defs>
            <CartesianGrid
              vertical={false}
              stroke="var(--border)"
              strokeOpacity={0.45}
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
              ticks={balanceTicks}
              tickFormatter={compactMoney}
              tickLine={false}
              axisLine={false}
              width={48}
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
              type="natural"
              dataKey="available"
              baseValue={0}
              stroke={`url(#${id}-line)`}
              strokeWidth={2.8}
              fill={`url(#${id}-area)`}
              dot={false}
              activeDot={{ r: 4, stroke: 'var(--background)', strokeWidth: 2 }}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <details className="mt-3 text-xs">
        <summary className="text-muted-foreground hover:text-foreground focus-visible:ring-primary/20 inline-flex cursor-pointer rounded-lg px-1 py-1 font-medium focus-visible:ring-3 focus-visible:outline-none">
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
                <tr key={row.year} className="odd:bg-muted/30">
                  <th
                    scope="row"
                    className="rounded-l-lg px-2 py-2 font-normal"
                  >
                    {row.year} · {ageLabel(row.year)}
                  </th>
                  <td className="rounded-r-lg px-2 py-2 text-right tabular-nums">
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
