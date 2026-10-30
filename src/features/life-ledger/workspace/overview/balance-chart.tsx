'use client';

import { useId, useState } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import {
  balanceAgeTicks,
  balanceChartScale,
  balanceZeroOffset,
} from '../../analysis/balance-chart-scale';
import type { annualChartData } from '../../analysis/chart-data';
import { moneyFormatter } from '../plan/fields';
import type { WorkspaceCopy } from '../workspace-types';

type Row = ReturnType<typeof annualChartData>[number];
type ChartMilestone = {
  year: number;
  age: number | null;
  labels: string[];
};

export function BalanceChart({
  rows,
  retirement,
  firstGapYear,
  copy,
  locale,
  milestones,
}: {
  rows: Row[];
  retirement: number;
  firstGapYear: number | null;
  copy: WorkspaceCopy;
  locale: string;
  milestones: ChartMilestone[];
}) {
  const different = rows.some((r) => r.available !== r.netWorth);
  const [compare, setCompare] = useState<boolean | null>(null);
  const showNetWorth = different && (compare ?? true);
  const id = useId().replaceAll(':', '');
  const values = rows.flatMap((r) =>
    showNetWorth ? [r.available, r.netWorth] : [r.available]
  );
  const { domain, ticks } = balanceChartScale(values);
  const threshold = balanceZeroOffset(rows.map((r) => r.available));
  const money = moneyFormatter(locale);
  const years = balanceAgeTicks(rows);
  const ending = rows.at(-1);
  const retirementRow = rows.find((row) => row.year === retirement);
  const checkpoints = [
    ...(retirementRow && retirementRow !== ending
      ? [{ row: retirementRow, label: copy.charts.retirement_balance }]
      : []),
    ...(ending ? [{ row: ending, label: copy.charts.ending_balance }] : []),
  ];
  const formatTick = (n: number) =>
    locale.startsWith('zh')
      ? `${new Intl.NumberFormat(locale, { maximumFractionDigits: 6 }).format(n / 1e6)}万`
      : `${new Intl.NumberFormat(locale, { maximumFractionDigits: 5 }).format(n / 1e5)}k`;
  const ageTick = (year: number) => {
    const r = rows.find((r) => r.year === year);
    return r?.ageEnd === null || r?.ageEnd === undefined
      ? String(year)
      : `${r.ageEnd}${locale.startsWith('zh') ? '岁' : ''}`;
  };
  return (
    <>
      <dl className="mt-4 grid max-w-xl grid-cols-2 gap-5">
        {checkpoints.map(({ row, label }) => (
          <div key={row.year}>
            <dt className="text-muted-foreground text-[11px] leading-snug">
              {label} · {ageTick(row.year)}
            </dt>
            <dd className="mt-1 text-xl font-semibold tracking-tight tabular-nums sm:text-2xl">
              {locale.startsWith('zh')
                ? `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(row.available / 1e6)} 万元`
                : money(row.available)}
            </dd>
          </div>
        ))}
      </dl>
      <div className="mt-3 flex min-h-8 items-center justify-end text-[11px]">
        {different ? (
          <label className="text-muted-foreground hover:bg-background hover:text-foreground inline-flex min-h-8 cursor-pointer items-center gap-2 rounded-lg px-2.5 transition-colors">
            <input
              type="checkbox"
              checked={showNetWorth}
              onChange={(event) => setCompare(event.target.checked)}
              className="accent-primary size-3.5"
            />
            <span className="w-4 border-t border-dashed border-current" />
            {copy.charts.compare_networth}
          </label>
        ) : (
          <span className="text-muted-foreground">
            {copy.charts.same_balances}
          </span>
        )}
      </div>
      <div className="h-64 sm:h-72" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={rows}
            margin={{ top: 18, right: 12, left: 0, bottom: 4 }}
          >
            <defs>
              <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset={0}
                  stopColor="var(--primary)"
                  stopOpacity={0.22}
                />
                <stop
                  offset={threshold}
                  stopColor="var(--primary)"
                  stopOpacity={0.04}
                />
                <stop
                  offset={threshold}
                  stopColor="#b7791f"
                  stopOpacity={0.06}
                />
                <stop offset={1} stopColor="#b7791f" stopOpacity={0.18} />
              </linearGradient>
              <linearGradient id={`${id}-line`} x1="0" y1="0" x2="0" y2="1">
                <stop offset={threshold} stopColor="var(--primary)" />
                <stop offset={threshold} stopColor="#b7791f" />
              </linearGradient>
            </defs>
            <CartesianGrid
              vertical={false}
              stroke="var(--border)"
              strokeOpacity={0.5}
            />
            <XAxis
              dataKey="year"
              type="number"
              domain={['dataMin', 'dataMax']}
              ticks={years}
              tickFormatter={ageTick}
              minTickGap={16}
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }}
              dy={8}
            />
            <YAxis
              domain={domain}
              ticks={ticks}
              tickFormatter={formatTick}
              width={64}
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }}
            />
            <Tooltip
              content={({ active, payload }) => {
                const row = payload?.[0]?.payload as Row | undefined;
                if (!active || !row) return null;
                return (
                  <div className="bg-background border-border min-w-44 rounded-lg border px-4 py-3 text-xs">
                    <p className="mb-3 font-medium">
                      {row.year}
                      {locale.startsWith('zh') ? ' 年' : ''}
                      {row.ageEnd === null
                        ? ''
                        : ` · ${row.ageEnd} ${copy.common.age}`}
                    </p>
                    <dl className="space-y-2">
                      <div className="flex justify-between gap-6">
                        <dt>{copy.overview.available}</dt>
                        <dd className="font-semibold tabular-nums">
                          {money(row.available)}
                        </dd>
                      </div>
                      {showNetWorth && (
                        <div className="text-muted-foreground flex justify-between gap-6">
                          <dt>{copy.overview.net_worth}</dt>
                          <dd className="tabular-nums">
                            {money(row.netWorth)}
                          </dd>
                        </div>
                      )}
                    </dl>
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
              strokeWidth={1.3}
            />
            {firstGapYear !== null && (
              <ReferenceLine
                x={firstGapYear}
                stroke="#b7791f"
                strokeDasharray="3 4"
                label={{
                  value: copy.overview.first_gap,
                  position:
                    firstGapYear === retirement
                      ? 'insideBottomRight'
                      : firstGapYear < (years[0] + years.at(-1)!) / 2
                        ? 'insideTopRight'
                        : 'insideTopLeft',
                  fill: '#a36c1f',
                  fontSize: 11,
                }}
              />
            )}
            {milestones.map((milestone) => (
              <ReferenceDot
                key={milestone.year}
                x={milestone.year}
                y={0}
                r={3}
                fill="var(--primary)"
                stroke="var(--background)"
                strokeWidth={1.5}
              />
            ))}
            <Area
              type="natural"
              dataKey="available"
              name={copy.overview.available}
              baseValue={0}
              stroke={`url(#${id}-line)`}
              strokeWidth={2.8}
              fill={`url(#${id}-fill)`}
              dot={false}
              activeDot={{ r: 4, stroke: 'var(--background)', strokeWidth: 2 }}
              isAnimationActive={false}
            />
            {showNetWorth && (
              <Line
                type="natural"
                dataKey="netWorth"
                name={copy.overview.net_worth}
                stroke="var(--muted-foreground)"
                strokeWidth={1.8}
                strokeDasharray="6 4"
                dot={false}
                isAnimationActive={false}
              />
            )}
            {checkpoints.map(({ row }) => (
              <ReferenceDot
                key={row.year}
                x={row.year}
                y={row.available}
                r={4}
                fill={row.available < 0 ? '#b7791f' : 'var(--primary)'}
                stroke="var(--background)"
                strokeWidth={2}
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {milestones.length > 0 && (
        <div className="border-border mt-1 flex flex-col gap-2 border-t pt-3 text-xs sm:flex-row sm:items-start sm:gap-4">
          <span className="text-muted-foreground shrink-0 font-medium">
            {copy.timeline.title}
          </span>
          <ol className="flex min-w-0 flex-wrap gap-x-5 gap-y-2">
            {milestones.map((milestone) => (
              <li
                key={milestone.year}
                className="flex min-w-0 items-baseline gap-2"
              >
                <span className="bg-primary size-1.5 shrink-0 rounded-full" />
                <span className="text-muted-foreground shrink-0 tabular-nums">
                  {milestone.age === null
                    ? milestone.year
                    : locale.startsWith('zh')
                      ? `${milestone.age}岁`
                      : `Age ${milestone.age}`}
                </span>
                <span className="min-w-0 font-medium">
                  {milestone.labels.join(locale.startsWith('zh') ? '、' : ', ')}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
      <div className="mt-2 mb-2 flex flex-wrap gap-x-4 gap-y-1.5 text-[11px]">
        <span className="inline-flex items-center gap-2">
          <span className="bg-primary h-0.5 w-5" />
          {copy.overview.available}
        </span>
        <span className="text-muted-foreground inline-flex items-center gap-2">
          <span className="h-0.5 w-5 bg-[#b7791f]" />
          {copy.charts.negative_hint}
        </span>
      </div>
    </>
  );
}
