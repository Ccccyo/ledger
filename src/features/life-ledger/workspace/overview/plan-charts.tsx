'use client';

import { useState } from 'react';
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { balanceAgeTicks } from '../../analysis/balance-chart-scale';
import { annualChartData, EXPENSE_GROUPS } from '../../analysis/chart-data';
import {
  buildMilestones,
  groupMilestonesByYear,
  selectPrimaryMilestones,
} from '../../analysis/milestones';
import type { MonthlyCalculationResult } from '../../calculation';
import { monthParts } from '../../domain';
import { moneyFormatter } from '../plan/fields';
import type { WorkspaceCopy } from '../workspace-types';
import { BalanceChart } from './balance-chart';

const colors = [
  '#4874B8',
  '#BE6742',
  '#3C8A69',
  '#B48A28',
  '#747B8B',
  '#AC6084',
];
export function PlanCharts({
  result,
  copy,
  locale,
}: {
  result: MonthlyCalculationResult;
  copy: WorkspaceCopy;
  locale: string;
}) {
  const rows = annualChartData(result);
  const [compareFlows, setCompareFlows] = useState(false);
  const ageTicks = balanceAgeTicks(rows);
  const ageLabel = (year: number) => {
    const age = rows.find((r) => r.year === year)?.ageEnd;
    return age == null
      ? String(year)
      : `${age}${locale.startsWith('zh') ? '岁' : ''}`;
  };
  const money = moneyFormatter(locale);
  const retirement = monthParts(result.input.retirementMonth).year;
  const peak = rows.reduce((a, b) => (a.expense >= b.expense ? a : b));
  const minimum = result.monthly.reduce((a, b) =>
    a.closingAvailableCents <= b.closingAvailableCents ? a : b
  );
  const milestoneGroups = groupMilestonesByYear(
    selectPrimaryMilestones(
      buildMilestones(result.input, result).filter(
        (marker) =>
          marker.source === 'user' &&
          !['start', 'end', 'retirement'].includes(marker.kind)
      ),
      6
    )
  ).map((group) => ({
    year: group.year,
    age: group.markers[0]?.age ?? null,
    labels: group.markers.map((marker) =>
      marker.label === 'loan-end'
        ? copy.timeline.loan_end
        : marker.kind === 'relocation'
          ? copy.relocation.timeline.replace('{city}', marker.label)
          : marker.label
    ),
  }));
  const tick = (value: number) =>
    locale.startsWith('zh')
      ? `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value / 1e6)}万`
      : `${Math.round(value / 1e5)}k`;
  return (
    <div className="grid gap-5">
      <section
        aria-labelledby="balance-chart-heading"
        className="bg-background border-border order-1 min-w-0 rounded-xl border p-4 sm:p-5"
      >
        <h2 id="balance-chart-heading" className="text-lg font-semibold">
          {copy.charts.balances}
        </h2>
        <p className="text-muted-foreground mt-2 text-sm">
          {copy.charts.balance_hint}
        </p>
        <BalanceChart
          rows={rows}
          retirement={retirement}
          firstGapYear={result.summary.firstGapYear}
          copy={copy}
          locale={locale}
          milestones={milestoneGroups}
        />
        <p className="text-muted-foreground text-xs">
          {copy.charts.minimum
            .replace(
              '{year}',
              String(
                result.monthly[0].openingAvailableCents <=
                  minimum.closingAvailableCents
                  ? result.monthly[0].year
                  : minimum.year
              )
            )
            .replace('{amount}', money(result.summary.minimumAvailableCents))}
        </p>
        <ChartTable
          rows={rows}
          keys={['available', 'netWorth', 'debt']}
          copy={copy}
          money={money}
        />
      </section>
      <section
        aria-labelledby="expense-chart-heading"
        className="bg-background border-border order-2 min-w-0 rounded-xl border p-4 sm:p-5"
      >
        <h2 id="expense-chart-heading" className="text-lg font-semibold">
          {compareFlows ? copy.charts.compare_flows : copy.charts.expenses}
        </h2>
        <div
          className="mt-2 flex flex-wrap gap-1"
          role="group"
          aria-label={copy.charts.compare_flows}
        >
          {[false, true].map((value) => (
            <button
              type="button"
              key={String(value)}
              aria-pressed={compareFlows === value}
              onClick={() => setCompareFlows(value)}
              className={`focus-visible:outline-primary min-h-11 rounded-md px-3 text-sm focus-visible:outline-2 ${compareFlows === value ? 'bg-primary/10 text-foreground font-medium' : 'text-muted-foreground hover:bg-muted'}`}
            >
              {value ? copy.charts.compare_flows : copy.charts.expenses}
            </button>
          ))}
        </div>
        <p className="text-muted-foreground mt-2 text-sm">
          {compareFlows
            ? copy.charts.compare_hint
            : copy.charts.peak
                .replace('{year}', String(peak.year))
                .replace('{amount}', money(peak.expense))}
        </p>
        {compareFlows ? (
          <div className="mt-4 h-72 sm:h-80" aria-hidden="true">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={rows}
                margin={{ top: 18, right: 4, left: 0, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="incomeFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#5f8f78" stopOpacity={0.2} />
                    <stop
                      offset="100%"
                      stopColor="#5f8f78"
                      stopOpacity={0.02}
                    />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis
                  dataKey="year"
                  ticks={ageTicks}
                  tickFormatter={ageLabel}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={30}
                  fontSize={12}
                />
                <YAxis
                  tickFormatter={tick}
                  width={58}
                  axisLine={false}
                  tickLine={false}
                  fontSize={12}
                  tickCount={5}
                />
                <Tooltip
                  labelFormatter={(year) =>
                    `${year} · ${ageLabel(Number(year))}`
                  }
                  formatter={(value, name) => [money(Number(value)), name]}
                  contentStyle={{
                    background: 'var(--background)',
                    borderColor: 'var(--border)',
                    color: 'var(--foreground)',
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar
                  dataKey="expense"
                  name={copy.ledger.expense}
                  fill="#a97962"
                  fillOpacity={0.62}
                  radius={[2, 2, 0, 0]}
                  isAnimationActive={false}
                />
                <Area
                  type="monotone"
                  dataKey="income"
                  name={copy.ledger.income}
                  stroke="#5f8f78"
                  strokeWidth={2.5}
                  fill="url(#incomeFill)"
                  dot={false}
                  activeDot={{ r: 4 }}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="mt-4 h-80 sm:h-96" aria-hidden="true">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={rows}
                margin={{ top: 20, right: 12, left: 0, bottom: 0 }}
              >
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis
                  dataKey="year"
                  ticks={ageTicks}
                  tickFormatter={ageLabel}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={30}
                  fontSize={12}
                />
                <YAxis
                  tickFormatter={tick}
                  width={58}
                  axisLine={false}
                  tickLine={false}
                  fontSize={12}
                />
                <Tooltip
                  labelFormatter={(year) =>
                    `${year} · ${ageLabel(Number(year))}`
                  }
                  formatter={(value) => money(Number(value))}
                  contentStyle={{
                    background: 'var(--background)',
                    borderColor: 'var(--border)',
                    color: 'var(--foreground)',
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {result.summary.firstGapYear !== null &&
                  result.summary.firstGapYear !== retirement && (
                    <ReferenceLine
                      x={result.summary.firstGapYear}
                      stroke="#b7791f"
                      strokeDasharray="3 3"
                    />
                  )}
                {EXPENSE_GROUPS.filter((key) =>
                  rows.some((r) => r[key] !== 0)
                ).map((key) => (
                  <Bar
                    key={key}
                    dataKey={key}
                    name={copy.charts.groups[key]}
                    stackId="expenses"
                    fill={colors[EXPENSE_GROUPS.indexOf(key)]}
                    isAnimationActive={false}
                  />
                ))}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
        <ChartTable
          rows={rows}
          keys={
            compareFlows
              ? ['income', 'expense']
              : [...EXPENSE_GROUPS, 'expense']
          }
          copy={copy}
          money={money}
        />
      </section>
    </div>
  );
}
function ChartTable({
  rows,
  keys,
  copy,
  money,
}: {
  rows: ReturnType<typeof annualChartData>;
  keys: string[];
  copy: WorkspaceCopy;
  money: (n: number) => string;
}) {
  const names: Record<string, string> = {
    ...copy.charts.groups,
    expense: copy.ledger.expense,
    income: copy.ledger.income,
    available: copy.overview.available,
    netWorth: copy.overview.net_worth,
    debt: copy.overview.debt,
  };
  return (
    <details className="border-border mt-4 max-w-full min-w-0 overflow-hidden border-t pt-3 text-sm">
      <summary className="text-muted-foreground cursor-pointer">
        {copy.overview.table_alternative}
      </summary>
      <div className="mt-3 w-full max-w-full overflow-x-auto">
        <table className="w-full text-left text-xs">
          <caption className="sr-only">
            {copy.overview.table_alternative}
          </caption>
          <thead>
            <tr>
              <th scope="col" className="p-2">
                {copy.ledger.year}
              </th>
              {keys.map((k) => (
                <th scope="col" key={k} className="p-2 whitespace-nowrap">
                  {names[k]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.year} className="border-border border-t">
                <th scope="row" className="p-2 font-normal">
                  {r.year}
                </th>
                {keys.map((k) => (
                  <td key={k} className="p-2 whitespace-nowrap tabular-nums">
                    {money(r[k as keyof typeof r] as number)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
