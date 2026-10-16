'use client';

import { useState } from 'react';
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
  calculateInvestmentRange,
  investmentRangeMarkers,
} from '../../analysis/investment-range';
import type { MonthlyCalculationResult } from '../../calculation';
import { addMonths, formatMonth } from '../../domain';
import { moneyFormatter } from '../plan/fields';
import type { WorkspaceCopy } from '../workspace-types';

export function ScenarioChart({
  result,
  copy,
  locale,
}: {
  result: MonthlyCalculationResult;
  copy: WorkspaceCopy;
  locale: string;
}) {
  const money = moneyFormatter(locale);
  const scenarios = result.input.metadata.investmentScenarios ?? [];
  const hasInvestments = scenarios.length > 0;
  const [selectedInvestmentId, setSelectedInvestmentId] = useState<
    string | null
  >(scenarios[0]?.id ?? null);
  const selectedInvestment =
    scenarios.find((scenario) => scenario.id === selectedInvestmentId) ??
    scenarios[0] ??
    null;
  const data = calculateInvestmentRange(result).map((row) => ({
    ...row,
    gainRange: [
      Math.max(row.principalCents, row.lowerCents),
      Math.max(row.principalCents, row.upperCents),
    ],
    lossRange: [
      Math.min(row.principalCents, row.lowerCents),
      Math.min(row.principalCents, row.upperCents),
    ],
    lossBoundary:
      row.started && row.lowerCents < row.principalCents
        ? row.lowerCents
        : null,
  }));
  const markers = investmentRangeMarkers(result).flatMap((marker) => {
    const row = data.find((item) => item.year === marker.year);
    if (!row) return [];
    return [
      {
        ...marker,
        y: row.principalCents,
      },
    ];
  });
  const chartValues = data.flatMap((row) => [
    row.lowerCents,
    row.principalCents,
    row.upperCents,
  ]);
  const rawMinimum = Math.min(0, ...chartValues);
  const rawMaximum = Math.max(0, ...chartValues);
  const padding = Math.max((rawMaximum - rawMinimum) * 0.06, 1);
  const domain: [number, number] = [
    rawMinimum < 0 ? rawMinimum - padding : 0,
    rawMaximum + padding,
  ];
  const tick = (value: number) =>
    locale.startsWith('zh')
      ? `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value / 1e6)}万`
      : `${Math.round(value / 1e5)}k`;

  return (
    <section
      aria-labelledby="scenario-chart-heading"
      className="bg-background border-border rounded-xl border p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="scenario-chart-heading" className="text-lg font-semibold">
            {copy.scenarios.title}
          </h2>
          <p className="text-muted-foreground mt-1 max-w-[70ch] text-sm">
            {copy.scenarios.hint}
          </p>
        </div>
        <div className="flex flex-wrap gap-4 text-xs">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-4 bg-[#596579]" aria-hidden="true" />
            {copy.scenarios.principal}
          </span>
          {hasInvestments && (
            <>
              <span className="inline-flex items-center gap-1.5">
                <span
                  className="h-2.5 w-4 bg-[#72a98c]/35"
                  aria-hidden="true"
                />
                {copy.scenarios.gain}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span
                  className="h-2.5 w-4 bg-[#c58c70]/30"
                  aria-hidden="true"
                />
                {copy.scenarios.loss}
              </span>
            </>
          )}
        </div>
      </div>
      {hasInvestments && (
        <div className="border-border bg-muted/25 mt-4 rounded-lg border px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <span className="text-muted-foreground text-xs font-medium">
              {copy.scenarios.schedule}
            </span>
            {scenarios.map((scenario) => {
              const selected = selectedInvestment?.id === scenario.id;
              return (
                <button
                  type="button"
                  key={scenario.id}
                  aria-pressed={selected}
                  onClick={() => setSelectedInvestmentId(scenario.id)}
                  className={`inline-flex min-h-9 flex-wrap items-center gap-2 rounded-full border px-3 py-1.5 text-left text-xs transition-colors focus-visible:ring-2 focus-visible:ring-[#2f805d]/35 focus-visible:outline-none ${
                    selected
                      ? 'border-[#2f805d]/45 bg-[#2f805d]/8 shadow-sm'
                      : 'bg-background border-border hover:border-[#2f805d]/30'
                  }`}
                >
                  <span className="font-medium">{scenario.name}</span>
                  <span className="text-[#2f805d]">
                    ● {formatMonth(scenario.startMonth)}{' '}
                    {copy.scenarios.start_node}
                  </span>
                  <span className="text-muted-foreground" aria-hidden="true">
                    →
                  </span>
                  <span className="text-[#8f5c46]">
                    ● {formatMonth(addMonths(scenario.endMonthExclusive, -1))}{' '}
                    {copy.scenarios.end_node}
                  </span>
                </button>
              );
            })}
          </div>
          {selectedInvestment && (
            <div className="border-border text-muted-foreground mt-2 flex flex-wrap gap-x-5 gap-y-1 border-t pt-2 text-xs">
              <span>
                {copy.scenarios.selected}:{' '}
                <strong className="text-foreground font-medium">
                  {selectedInvestment.name}
                </strong>
              </span>
              <span>
                {copy.investment.principal}:{' '}
                <strong className="text-foreground font-medium tabular-nums">
                  {money(selectedInvestment.principalCents)}
                </strong>
              </span>
              <span>{copy.investment.risks[selectedInvestment.riskLevel]}</span>
              <span>
                {copy.scenarios.annual_range}:{' '}
                <strong className="text-foreground font-medium tabular-nums">
                  {selectedInvestment.lowerAnnualReturnBps / 100}% —{' '}
                  {selectedInvestment.upperAnnualReturnBps / 100}%
                </strong>
              </span>
            </div>
          )}
        </div>
      )}
      <div className="mt-3 h-64 sm:h-72" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={data}
            margin={{ top: 12, right: 12, left: 0, bottom: 0 }}
          >
            <CartesianGrid
              vertical={false}
              stroke="var(--border)"
              strokeDasharray="3 5"
            />
            <XAxis
              dataKey="year"
              tickFormatter={(year) => {
                const age = data.find((row) => row.year === year)?.age;
                return age == null
                  ? String(year)
                  : `${age}${locale.startsWith('zh') ? '岁' : ''}`;
              }}
              tickLine={false}
              axisLine={false}
              minTickGap={28}
              fontSize={12}
            />
            <YAxis
              domain={domain}
              tickFormatter={tick}
              tickLine={false}
              axisLine={false}
              width={58}
              fontSize={12}
            />
            <Tooltip
              content={({ active, payload }) => {
                const row = payload?.[0]?.payload as
                  | (typeof data)[number]
                  | undefined;
                if (!active || !row) return null;
                return (
                  <div className="bg-background border-border min-w-48 rounded-lg border px-4 py-3 text-xs">
                    <p className="mb-3 font-medium">
                      {row.year}
                      {row.age == null
                        ? ''
                        : ` · ${row.age}${locale.startsWith('zh') ? '岁' : ''}`}
                    </p>
                    <dl className="space-y-2">
                      <div className="flex justify-between gap-5">
                        <dt>{copy.scenarios.principal}</dt>
                        <dd className="font-semibold tabular-nums">
                          {money(row.principalCents)}
                        </dd>
                      </div>
                      {hasInvestments && !row.started && (
                        <p className="text-muted-foreground">
                          {copy.scenarios.not_started}
                        </p>
                      )}
                      {hasInvestments && row.started && (
                        <>
                          <div className="text-muted-foreground flex justify-between gap-5">
                            <dt>{copy.scenarios.lower}</dt>
                            <dd className="tabular-nums">
                              {money(row.lowerCents)}
                            </dd>
                          </div>
                          <div className="text-muted-foreground flex justify-between gap-5">
                            <dt>{copy.scenarios.upper}</dt>
                            <dd className="tabular-nums">
                              {money(row.upperCents)}
                            </dd>
                          </div>
                        </>
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
            <ReferenceLine y={0} stroke="var(--muted-foreground)" />
            {hasInvestments && (
              <Area
                type="monotone"
                dataKey="gainRange"
                stroke="none"
                fill="#72a98c"
                fillOpacity={0.28}
                isAnimationActive={false}
              />
            )}
            {hasInvestments && (
              <Area
                type="monotone"
                dataKey="lossRange"
                stroke="none"
                fill="#c58c70"
                fillOpacity={0.24}
                isAnimationActive={false}
              />
            )}
            {hasInvestments && (
              <Line
                type="monotone"
                dataKey="lossBoundary"
                stroke="#a66f57"
                strokeWidth={1.5}
                dot={false}
                connectNulls={false}
                isAnimationActive={false}
              />
            )}
            <Line
              type="monotone"
              dataKey="principalCents"
              stroke="#596579"
              strokeWidth={2.5}
              dot={false}
              activeDot={{ r: 4, stroke: 'var(--background)', strokeWidth: 2 }}
              isAnimationActive={false}
            />
            {markers.map((marker) => {
              const selected = selectedInvestment
                ? marker.ids.includes(selectedInvestment.id)
                : false;
              return (
                <ReferenceDot
                  key={`${marker.year}-${marker.kind}`}
                  x={marker.year}
                  y={marker.y}
                  r={selected ? 6 : 4.5}
                  fill={marker.kind === 'start' ? '#2f805d' : '#a66f57'}
                  fillOpacity={selectedInvestment && !selected ? 0.35 : 1}
                  stroke="var(--background)"
                  strokeWidth={2}
                  ifOverflow="extendDomain"
                  cursor="pointer"
                  onClick={() => setSelectedInvestmentId(marker.ids[0] ?? null)}
                />
              );
            })}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="text-muted-foreground mt-2 text-xs">
        {hasInvestments ? copy.scenarios.basis : copy.scenarios.empty}
      </p>
    </section>
  );
}
