'use client';

import { useState } from 'react';
import type {
  AnnualLedgerRow,
  MonthlyCalculationResult,
} from '@/features/life-ledger/calculation';
import { monthParts } from '@/features/life-ledger/domain';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Landmark,
  Scale,
  TrendingDown,
  WalletCards,
} from 'lucide-react';

import { keyYears } from '../../analysis/chart-data';
import { WorkspaceDrawer } from '../components/workspace-drawer';
import type { WorkspaceCopy } from '../workspace-types';

export function LedgerView({
  locale,
  copy,
  result,
}: {
  locale: string;
  copy: WorkspaceCopy;
  result: MonthlyCalculationResult;
}) {
  const formatMoney = moneyFormatter(locale);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);
  const years = keyYears(result);
  const rows = showAll
    ? result.annual
    : result.annual.filter((r) => years.includes(r.year));
  const selected = result.annual.find((row) => row.year === selectedYear);
  const scale = {
    income: Math.max(1, ...rows.map((row) => Math.abs(row.incomeCents))),
    expense: Math.max(1, ...rows.map((row) => Math.abs(row.expenseCents))),
    available: Math.max(
      1,
      ...rows.map((row) => Math.abs(row.closingAvailableCents))
    ),
    debt: Math.max(
      1,
      ...rows.map((row) => Math.abs(row.closingDebtBalanceCents))
    ),
    netWorth: Math.max(
      1,
      ...rows.map((row) => Math.abs(row.closingNetWorthCents))
    ),
  };

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1
            id="ledger-heading"
            className="text-2xl font-semibold tracking-tight"
          >
            {copy.ledger.title}
          </h1>
          <p className="text-muted-foreground mt-2 max-w-[70ch] text-sm leading-relaxed">
            {copy.ledger.description}
          </p>
        </div>
        {result.summary.firstGapYear && (
          <button
            type="button"
            onClick={() => setSelectedYear(result.summary.firstGapYear)}
            className="border-border bg-background hover:bg-muted focus-visible:ring-primary/30 inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border px-3.5 text-sm font-medium focus-visible:ring-4 focus-visible:outline-none"
          >
            <TrendingDown
              className="size-4 text-amber-600"
              aria-hidden="true"
            />
            {copy.ledger.locate_gap}
          </button>
        )}
      </div>

      <div
        className="mt-6 flex gap-2"
        role="group"
        aria-label={copy.ledger.year_filter}
      >
        {[false, true].map((all) => (
          <button
            key={String(all)}
            type="button"
            aria-pressed={showAll === all}
            onClick={() => setShowAll(all)}
            className="border-border hover:bg-muted aria-pressed:border-primary aria-pressed:text-primary focus-visible:ring-primary/30 min-h-11 rounded-lg border px-3 text-sm focus-visible:ring-4 focus-visible:outline-none"
          >
            {all ? copy.ledger.all_years : copy.ledger.key_years}
          </button>
        ))}
      </div>
      <div className="border-border bg-background mt-4 overflow-hidden rounded-xl border">
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[54rem] text-left text-sm">
            <thead className="bg-muted/60 text-foreground text-xs">
              <tr>
                {[
                  { heading: copy.ledger.year },
                  { heading: copy.ledger.phase },
                  { heading: copy.ledger.income, icon: ArrowDownToLine },
                  { heading: copy.ledger.expense, icon: ArrowUpFromLine },
                  { heading: copy.ledger.available, icon: WalletCards },
                  { heading: copy.ledger.debt, icon: Landmark },
                  { heading: copy.ledger.net_worth, icon: Scale },
                ].map(({ heading, icon: Icon }) => (
                  <th key={heading} className="px-5 py-3 font-medium">
                    <span className="inline-flex items-center gap-2">
                      {Icon && (
                        <Icon
                          className="text-muted-foreground size-3.5"
                          aria-hidden="true"
                        />
                      )}
                      {heading}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {rows.map((row) => (
                <tr key={row.year} className="hover:bg-muted/35">
                  <td className="px-5 py-3 font-medium">
                    <button
                      type="button"
                      onClick={() => setSelectedYear(row.year)}
                      className="hover:text-primary focus-visible:ring-primary/30 rounded-sm underline-offset-4 hover:underline focus-visible:ring-4 focus-visible:outline-none"
                    >
                      {row.year}
                      <span className="text-muted-foreground mt-1 block text-xs">
                        {row.ageStart === null
                          ? ''
                          : `${row.ageStart}${row.ageEnd !== row.ageStart ? `–${row.ageEnd}` : ''} ${copy.common.age}`}
                      </span>
                    </button>
                  </td>
                  <td className="text-muted-foreground px-5 py-3">
                    {copy.ledger[row.phase]}
                  </td>
                  <MetricCell
                    value={row.incomeCents}
                    maximum={scale.income}
                    formatMoney={formatMoney}
                    tone="bg-emerald-700/55"
                    text="text-foreground"
                  />
                  <MetricCell
                    value={row.expenseCents}
                    maximum={scale.expense}
                    formatMoney={formatMoney}
                    tone="bg-orange-700/50"
                    text="text-foreground"
                  />
                  <MetricCell
                    value={row.closingAvailableCents}
                    maximum={scale.available}
                    formatMoney={formatMoney}
                    tone={
                      row.closingAvailableCents < 0
                        ? 'bg-red-600'
                        : 'bg-sky-700/50'
                    }
                    text={
                      row.closingAvailableCents < 0
                        ? 'text-destructive'
                        : 'text-foreground'
                    }
                  />
                  <MetricCell
                    value={row.closingDebtBalanceCents}
                    maximum={scale.debt}
                    formatMoney={formatMoney}
                    tone="bg-violet-700/45"
                    text="text-foreground"
                  />
                  <MetricCell
                    value={row.closingNetWorthCents}
                    maximum={scale.netWorth}
                    formatMoney={formatMoney}
                    tone={
                      row.closingNetWorthCents < 0
                        ? 'bg-red-600'
                        : 'bg-teal-700/50'
                    }
                    text={
                      row.closingNetWorthCents < 0
                        ? 'text-destructive'
                        : 'text-foreground'
                    }
                  />
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="divide-border divide-y md:hidden">
          {rows.map((row) => (
            <button
              key={row.year}
              type="button"
              onClick={() => setSelectedYear(row.year)}
              className="hover:bg-muted focus-visible:ring-primary/30 grid w-full grid-cols-[auto_1fr] items-center gap-x-5 gap-y-2 px-4 py-4 text-left focus-visible:ring-4 focus-visible:outline-none"
            >
              <span>
                <strong className="text-sm">{row.year}</strong>
                <span className="text-muted-foreground mt-1 block text-xs">
                  {row.minimumAvailableCents < 0
                    ? copy.ledger.gap
                    : copy.ledger.no_gap}
                </span>
              </span>
              <span
                className={`text-right text-sm font-semibold tabular-nums ${row.closingAvailableCents < 0 ? 'text-destructive' : 'text-foreground'}`}
              >
                {formatMoney(row.closingAvailableCents)}
              </span>
              <span
                className="col-span-2 grid grid-cols-2 gap-1"
                aria-hidden="true"
              >
                <span className="bg-muted h-1.5 overflow-hidden rounded-sm">
                  <span
                    className="block h-full bg-emerald-700/55"
                    style={{
                      width: `${Math.min(100, (row.incomeCents / scale.income) * 100)}%`,
                    }}
                  />
                </span>
                <span className="bg-muted h-1.5 overflow-hidden rounded-sm">
                  <span
                    className="block h-full bg-orange-700/50"
                    style={{
                      width: `${Math.min(100, (row.expenseCents / scale.expense) * 100)}%`,
                    }}
                  />
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>

      {selected && (
        <YearDrawer
          row={selected}
          result={result}
          copy={copy}
          formatMoney={formatMoney}
          onClose={() => setSelectedYear(null)}
        />
      )}
    </div>
  );
}

function MetricCell({
  value,
  maximum,
  formatMoney,
  tone,
  text,
}: {
  value: number;
  maximum: number;
  formatMoney: (value: number) => string;
  tone: string;
  text: string;
}) {
  return (
    <td className="px-5 py-3 tabular-nums">
      <span className={`font-medium ${text}`}>{formatMoney(value)}</span>
      <span
        className="bg-muted mt-2 block h-1 w-full max-w-28 overflow-hidden rounded-sm"
        aria-hidden="true"
      >
        <span
          className={`block h-full ${tone}`}
          style={{
            width: `${Math.min(100, (Math.abs(value) / maximum) * 100)}%`,
          }}
        />
      </span>
    </td>
  );
}

function YearDrawer({
  row,
  result,
  copy,
  formatMoney,
  onClose,
}: {
  row: AnnualLedgerRow;
  result: MonthlyCalculationResult;
  copy: WorkspaceCopy;
  formatMoney: (value: number) => string;
  onClose: () => void;
}) {
  const items = [
    [copy.ledger.income, row.incomeCents],
    [copy.ledger.expense, row.expenseCents],
    [copy.ledger.available, row.closingAvailableCents],
    [copy.ledger.debt, row.closingDebtBalanceCents],
    [copy.ledger.net_worth, row.closingNetWorthCents],
  ] as const;
  const titleId = `ledger-year-${row.year}`;

  return (
    <WorkspaceDrawer
      title={String(row.year)}
      description={copy.ledger.year_detail}
      closeLabel={copy.common.close}
      onClose={onClose}
    >
      <dl className="border-border mt-7 divide-y border-y">
        {items.map(([label, value]) => (
          <div
            key={label}
            className="flex items-baseline justify-between gap-5 py-4"
          >
            <dt className="text-muted-foreground text-sm">{label}</dt>
            <dd className="font-semibold tabular-nums">{formatMoney(value)}</dd>
          </div>
        ))}
      </dl>
      <details className="border-border mt-7 border-b pb-5">
        <summary className="cursor-pointer text-sm font-semibold">
          {copy.ledger.categories}
        </summary>
        <div className="mt-4 space-y-3">
          {Object.entries(row.expenseByCategory).map(([category, amount]) => (
            <div
              key={category}
              className="flex items-center justify-between text-sm"
            >
              <span className="text-muted-foreground">
                {copy.categories[category] ?? category}
              </span>
              <strong className="tabular-nums">{formatMoney(amount)}</strong>
            </div>
          ))}
        </div>
      </details>
      <h3 className="mt-7 font-medium">{copy.ledger.monthly}</h3>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr>
              {[
                copy.ledger.month,
                copy.ledger.income,
                copy.ledger.expense,
                copy.overview.available,
              ].map((label) => (
                <th
                  key={label}
                  scope="col"
                  className="py-3 pr-3 whitespace-nowrap"
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.monthly
              .filter((r) => r.year === row.year)
              .map((r) => (
                <tr key={r.month} className="border-border border-t">
                  <th scope="row" className="py-3 pr-3 font-normal">
                    {monthParts(r.month).month}
                  </th>
                  {[r.incomeCents, r.expenseCents, r.closingAvailableCents].map(
                    (value, i) => (
                      <td
                        key={i}
                        className="py-3 pr-3 whitespace-nowrap tabular-nums"
                      >
                        {formatMoney(value)}
                      </td>
                    )
                  )}
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </WorkspaceDrawer>
  );
}

function moneyFormatter(locale: string) {
  const formatter = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  return (value: number) =>
    `${formatter.format(Math.round(value / 100))} ${locale.startsWith('zh') ? '元' : 'CNY'}`;
}
