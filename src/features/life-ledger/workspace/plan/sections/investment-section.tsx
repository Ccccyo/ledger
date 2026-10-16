'use client';

import { useState, type FormEvent } from 'react';
import { Plus, Trash2 } from 'lucide-react';

import {
  addMonths,
  formatMonth,
  monthIndex,
  type InvestmentRiskLevel,
  type InvestmentScenario,
} from '../../../domain';
import { markPlanDraftChanged } from '../../navigation';
import { moneyFormatter } from '../fields';
import {
  removeInvestmentScenario,
  saveInvestmentScenario,
} from '../investment-mutations';
import type { SectionProps } from '../types';

const control =
  'border-input bg-background focus-visible:ring-primary/30 h-11 w-full rounded-lg border px-3 text-sm focus-visible:ring-4 focus-visible:outline-none';
const presets: Record<
  Exclude<InvestmentRiskLevel, 'custom'>,
  [number, number]
> = {
  low: [-3, 5],
  medium: [-10, 15],
  high: [-25, 30],
};

export function InvestmentSection(props: SectionProps) {
  const { plan, copy, locale, onChange } = props;
  const items = plan.metadata.investmentScenarios ?? [];
  const [editing, setEditing] = useState<string | 'new' | null>(
    items.length ? null : 'new'
  );
  return (
    <div className="space-y-5">
      <p className="text-muted-foreground max-w-[65ch] text-sm leading-relaxed">
        {copy.investment.principal_basis}
      </p>
      {items.length > 0 && (
        <ul className="divide-border divide-y">
          {items.map((item) => (
            <li key={item.id} className="py-4 first:pt-0">
              {editing === item.id ? (
                <InvestmentForm
                  {...props}
                  item={item}
                  onClose={() => setEditing(null)}
                />
              ) : (
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{item.name}</p>
                    <p className="text-muted-foreground mt-1 text-xs">
                      {moneyFormatter(locale)(item.principalCents)} ·{' '}
                      {copy.investment.risks[item.riskLevel]} ·{' '}
                      {item.lowerAnnualReturnBps / 100}% —{' '}
                      {item.upperAnnualReturnBps / 100}%
                    </p>
                    <p className="text-muted-foreground mt-1 text-xs">
                      {formatMonth(item.startMonth)} —{' '}
                      {formatMonth(addMonths(item.endMonthExclusive, -1))}
                    </p>
                  </div>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground min-h-11 px-1 text-sm"
                      onClick={() => setEditing(item.id)}
                    >
                      {copy.editor.edit}
                    </button>
                    <button
                      type="button"
                      aria-label={`${copy.editor.remove} ${item.name}`}
                      className="text-muted-foreground hover:text-destructive flex min-h-11 items-center gap-1.5 px-1 text-sm"
                      onClick={() =>
                        onChange((current) =>
                          removeInvestmentScenario(current, item.id)
                        )
                      }
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                      {copy.editor.remove}
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {editing === 'new' ? (
        <InvestmentForm {...props} onClose={() => setEditing(null)} />
      ) : (
        editing === null && (
          <button
            type="button"
            className="border-primary/40 text-primary hover:bg-primary/5 focus-visible:ring-primary/30 inline-flex min-h-11 items-center gap-2 rounded-lg border px-4 text-sm font-medium focus-visible:ring-4 focus-visible:outline-none"
            onClick={() => setEditing('new')}
          >
            <Plus className="size-4" aria-hidden="true" />
            {copy.investment.add}
          </button>
        )
      )}
    </div>
  );
}

function InvestmentForm({
  plan,
  copy,
  onChange,
  item,
  onClose,
}: SectionProps & {
  item?: InvestmentScenario;
  onClose: () => void;
}) {
  const [risk, setRisk] = useState<InvestmentRiskLevel>(
    item?.riskLevel ?? 'medium'
  );
  const initialRange =
    risk === 'custom' ? [-10, 15] : presets[risk as keyof typeof presets];
  const [lower, setLower] = useState(
    item ? String(item.lowerAnnualReturnBps / 100) : String(initialRange[0])
  );
  const [upper, setUpper] = useState(
    item ? String(item.upperAnnualReturnBps / 100) : String(initialRange[1])
  );
  const [error, setError] = useState('');
  const defaultEndExclusive = addMonths(
    plan.baseMonth,
    Math.min(120, plan.endMonthExclusive - plan.baseMonth)
  );
  const parseMonth = (value: string) => {
    const [year, month] = value.split('-').map(Number);
    return monthIndex(year, month);
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    try {
      const input = {
        id: item?.id ?? crypto.randomUUID(),
        name: String(data.get('name')),
        principalYuan: Number(data.get('principal')) * 10_000,
        riskLevel: risk,
        lowerAnnualPercent: Number(lower),
        upperAnnualPercent: Number(upper),
        startMonth: parseMonth(String(data.get('start'))),
        endMonthExclusive: addMonths(parseMonth(String(data.get('end'))), 1),
      };
      saveInvestmentScenario(plan, input);
      onChange((current) => saveInvestmentScenario(current, input));
      onClose();
    } catch {
      setError(copy.investment.error);
    }
  };
  return (
    <form
      onSubmit={submit}
      onChange={markPlanDraftChanged}
      className="max-w-2xl space-y-4"
      noValidate
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1.5 text-sm">
          {copy.investment.name}
          <input
            name="name"
            required
            maxLength={80}
            defaultValue={item?.name ?? copy.investment.default_name}
            className={control}
          />
        </label>
        <label className="grid gap-1.5 text-sm">
          {copy.investment.principal}
          <span className="border-input bg-background flex h-11 items-center rounded-lg border px-3">
            <input
              name="principal"
              type="number"
              required
              min="0.01"
              step="0.01"
              defaultValue={item ? item.principalCents / 1_000_000 : ''}
              className="min-w-0 flex-1 bg-transparent tabular-nums outline-none"
            />
            <span className="text-muted-foreground text-xs">
              {copy.editor.ten_thousand}
            </span>
          </span>
        </label>
        <label className="grid gap-1.5 text-sm">
          {copy.investment.risk}
          <select
            value={risk}
            className={control}
            onChange={(event) => {
              const next = event.target.value as InvestmentRiskLevel;
              setRisk(next);
              if (next !== 'custom') {
                setLower(String(presets[next][0]));
                setUpper(String(presets[next][1]));
              }
            }}
          >
            {(['low', 'medium', 'high', 'custom'] as const).map((value) => (
              <option key={value} value={value}>
                {copy.investment.risks[value]}
              </option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="grid gap-1.5 text-sm">
            {copy.investment.lower}
            <input
              type="number"
              min="-100"
              max="200"
              step="0.1"
              value={lower}
              onChange={(event) => {
                setLower(event.target.value);
                setRisk('custom');
              }}
              className={control}
            />
          </label>
          <label className="grid gap-1.5 text-sm">
            {copy.investment.upper}
            <input
              type="number"
              min="-100"
              max="200"
              step="0.1"
              value={upper}
              onChange={(event) => {
                setUpper(event.target.value);
                setRisk('custom');
              }}
              className={control}
            />
          </label>
        </div>
        <label className="grid gap-1.5 text-sm">
          {copy.investment.start}
          <input
            name="start"
            type="month"
            required
            min={formatMonth(plan.baseMonth)}
            max={formatMonth(addMonths(plan.endMonthExclusive, -1))}
            defaultValue={formatMonth(item?.startMonth ?? plan.baseMonth)}
            className={control}
          />
        </label>
        <label className="grid gap-1.5 text-sm">
          {copy.investment.end}
          <input
            name="end"
            type="month"
            required
            min={formatMonth(plan.baseMonth)}
            max={formatMonth(addMonths(plan.endMonthExclusive, -1))}
            defaultValue={formatMonth(
              addMonths(item?.endMonthExclusive ?? defaultEndExclusive, -1)
            )}
            className={control}
          />
        </label>
      </div>
      <p className="text-muted-foreground text-xs leading-relaxed">
        {copy.investment.range_hint}
      </p>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          className="bg-primary text-primary-foreground min-h-11 rounded-lg px-4 text-sm font-semibold"
        >
          {copy.editor.save}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground min-h-11 px-3 text-sm"
        >
          {copy.editor.cancel}
        </button>
      </div>
    </form>
  );
}
