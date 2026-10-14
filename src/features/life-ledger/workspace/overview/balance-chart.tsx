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
export function BalanceChart({
  rows,
  retirement,
  firstGapYear,
  copy,
  locale,
}: {
  rows: Row[];
  retirement: number;
  firstGapYear: number | null;
  copy: WorkspaceCopy;
  locale: string;
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
      <dl className="border-border mt-5 flex flex-wrap gap-x-10 gap-y-4 border-y py-4">
        {checkpoints.map(({ row, label }) => (
          <div key={row.year}>
            <dt className="text-muted-foreground text-xs">
              {label} · {ageTick(row.year)}
            </dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums">
              {locale.startsWith('zh')
                ? `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(row.available / 1e6)} 万元`
                : money(row.available)}
            </dd>
          </div>
        ))}
      </dl>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs">
        <span className="text-muted-foreground">{copy.charts.age_axis}</span>
        {different ? (
          <label className="flex min-h-11 cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={showNetWorth}
              onChange={(e) => setCompare(e.target.checked)}
              className="accent-primary size-4"
            />
            {copy.charts.compare_networth}
          </label>
        ) : (
          <span className="text-muted-foreground">
            {copy.charts.same_balances}
          </span>
        )}
      </div>
      <div className="h-72 sm:h-80" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={rows}
            margin={{ top: 28, right: 20, left: 0, bottom: 6 }}
          >
            <defs>
              <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset={threshold}
                  stopColor="var(--primary)"
                  stopOpacity={0.12}
                />
                <stop
                  offset={threshold}
                  stopColor="#b7791f"
                  stopOpacity={0.13}
                />
              </linearGradient>
              <linearGradient id={`${id}-line`} x1="0" y1="0" x2="0" y2="1">
                <stop offset={threshold} stopColor="var(--primary)" />
                <stop offset={threshold} stopColor="#b7791f" />
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
            <ReferenceLine
              x={retirement}
              stroke="var(--muted-foreground)"
              strokeDasharray="4 5"
              label={{
                value: copy.plan.sections.retirement,
                position: 'insideTopRight',
                fill: 'var(--muted-foreground)',
                fontSize: 11,
              }}
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
            <Area
              dataKey="available"
              name={copy.overview.available}
              baseValue={0}
              stroke={`url(#${id}-line)`}
              strokeWidth={2.5}
              fill={`url(#${id}-fill)`}
              dot={false}
              activeDot={{ r: 4, stroke: 'var(--background)', strokeWidth: 2 }}
              isAnimationActive={false}
            />
            {showNetWorth && (
              <Line
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
      <div className="mt-3 mb-3 flex flex-wrap gap-x-5 gap-y-2 text-xs">
        <span className="inline-flex items-center gap-2">
          <span className="bg-primary h-0.5 w-5" />
          {copy.overview.available}
        </span>
        {showNetWorth && (
          <span className="text-muted-foreground inline-flex items-center gap-2">
            <span className="w-5 border-t-2 border-dashed border-current" />
            {copy.overview.net_worth}
          </span>
        )}
        <span className="text-muted-foreground inline-flex items-center gap-2">
          <span className="h-0.5 w-5 bg-[#b7791f]" />
          {copy.charts.negative_hint}
        </span>
      </div>
    </>
  );
}
