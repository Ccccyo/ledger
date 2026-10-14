'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { annualChartData, EXPENSE_GROUPS } from '../../analysis/chart-data';
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
  const money = moneyFormatter(locale);
  const retirement = monthParts(result.input.retirementMonth).year;
  const peak = rows.reduce((a, b) => (a.expense >= b.expense ? a : b));
  const minimum = result.monthly.reduce((a, b) =>
    a.closingAvailableCents <= b.closingAvailableCents ? a : b
  );
  const tick = (value: number) =>
    locale.startsWith('zh')
      ? `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value / 1e6)}万`
      : `${Math.round(value / 1e5)}k`;
  return (
    <div className="space-y-9">
      <section aria-labelledby="expense-chart-heading">
        <h2 id="expense-chart-heading" className="text-lg font-semibold">
          {copy.charts.expenses}
        </h2>
        <p className="text-muted-foreground mt-2 text-sm">
          {copy.charts.peak
            .replace('{year}', String(peak.year))
            .replace('{amount}', money(peak.expense))}
        </p>
        <div className="mt-5 h-80" aria-hidden="true">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={rows}
              margin={{ top: 20, right: 12, left: 0, bottom: 0 }}
            >
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis
                dataKey="year"
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
                formatter={(value) => money(Number(value))}
                contentStyle={{
                  background: 'var(--background)',
                  borderColor: 'var(--border)',
                  color: 'var(--foreground)',
                }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <ReferenceLine
                x={retirement}
                stroke="var(--muted-foreground)"
                strokeDasharray="4 4"
                label={{ value: copy.plan.sections.retirement, fontSize: 11 }}
              />
              {result.summary.firstGapYear !== null &&
                result.summary.firstGapYear !== retirement && (
                  <ReferenceLine
                    x={result.summary.firstGapYear}
                    stroke="#b7791f"
                    strokeDasharray="3 3"
                  />
                )}
              {EXPENSE_GROUPS.map((key, i) => (
                <Bar
                  key={key}
                  dataKey={key}
                  name={copy.charts.groups[key]}
                  stackId="expenses"
                  fill={colors[i]}
                  isAnimationActive={false}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
        <ChartTable
          rows={rows}
          keys={[...EXPENSE_GROUPS, 'expense']}
          copy={copy}
          money={money}
        />
      </section>
      <section aria-labelledby="balance-chart-heading">
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
    available: copy.overview.available,
    netWorth: copy.overview.net_worth,
    debt: copy.overview.debt,
  };
  return (
    <details className="border-border mt-4 border-t pt-3 text-sm">
      <summary className="text-muted-foreground cursor-pointer">
        {copy.overview.table_alternative}
      </summary>
      <div className="mt-3 overflow-x-auto">
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
