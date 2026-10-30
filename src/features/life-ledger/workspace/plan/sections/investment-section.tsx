'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { ArrowUpRight, Plus, Trash2 } from 'lucide-react';

import {
  addMonths,
  createLocalId,
  formatMonth,
  monthIndex,
  type InvestmentRiskLevel,
  type InvestmentScenario,
} from '../../../domain';
import { markPlanDraftChanged } from '../../navigation';
import { moneyFormatter } from '../fields';
import {
  availableInvestmentPrincipalCents,
  InvestmentAllocationError,
  removeInvestmentScenario,
  saveInvestmentScenario,
} from '../investment-mutations';
import type { SectionProps } from '../types';

const control =
  'border-input bg-background focus-visible:ring-primary/30 h-11 w-full min-w-0 rounded-lg border px-3 text-sm focus-visible:ring-4 focus-visible:outline-none';
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
      {items.length > 0 && (
        <ul className="space-y-3">
          {items.map((item) => (
            <li
              key={item.id}
              className="border-border/75 bg-background rounded-xl border p-4 shadow-[0_16px_32px_-28px_rgba(15,23,42,0.7)]"
            >
              {editing === item.id ? (
                <InvestmentForm
                  {...props}
                  item={item}
                  onClose={() => setEditing(null)}
                />
              ) : (
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{item.name}</p>
                    <p className="mt-1 text-xl font-semibold tracking-tight tabular-nums">
                      {moneyFormatter(locale)(item.principalCents)}
                    </p>
                    <p className="text-muted-foreground mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                      <span>{copy.investment.risks[item.riskLevel]}</span>
                      <span>
                        {item.lowerAnnualReturnBps / 100}% —{' '}
                        {item.upperAnnualReturnBps / 100}%
                      </span>
                      <span>
                        {formatMonth(item.startMonth)} —{' '}
                        {formatMonth(addMonths(item.endMonthExclusive, -1))}
                      </span>
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
      {props.onInvestmentAnalysis && (
        <div className="group/analysis relative">
          <button
            type="button"
            aria-describedby="investment-analysis-guide"
            onClick={props.onInvestmentAnalysis}
            className="border-border bg-background hover:border-primary/30 hover:bg-primary/[0.025] focus-visible:ring-primary/25 flex min-h-14 w-full items-center gap-4 rounded-xl border px-4 py-3 text-left shadow-[0_14px_30px_-28px_rgba(15,23,42,0.75)] transition-colors focus-visible:ring-4 focus-visible:outline-none"
          >
            <span className="min-w-0 flex-1 text-sm font-medium tracking-tight">
              {copy.investment.view_analysis}
            </span>
            <span className="bg-primary/8 text-primary grid size-8 shrink-0 place-items-center rounded-full transition-transform group-hover/analysis:translate-x-0.5 group-hover/analysis:-translate-y-0.5">
              <ArrowUpRight className="size-4" aria-hidden="true" />
            </span>
          </button>
          <span
            id="investment-analysis-guide"
            role="tooltip"
            className="bg-background text-foreground border-border pointer-events-none absolute bottom-[calc(100%+0.5rem)] left-3 z-30 max-w-xs rounded-lg border px-3 py-2 text-xs leading-relaxed opacity-0 shadow-xl transition-opacity group-focus-within/analysis:opacity-100 group-hover/analysis:opacity-100"
          >
            {copy.investment.analysis_guide}
          </span>
        </div>
      )}
    </div>
  );
}

function InvestmentForm({
  plan,
  copy,
  locale,
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
  const [start, setStart] = useState(
    formatMonth(item?.startMonth ?? plan.baseMonth)
  );
  const availableAtStart = useMemo(() => {
    try {
      return availableInvestmentPrincipalCents(
        plan,
        parseMonth(start),
        item?.id
      );
    } catch {
      return null;
    }
  }, [item?.id, plan, start]);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    try {
      const input = {
        id: item?.id ?? createLocalId('investment'),
        name: String(data.get('name')),
        principalYuan: Number(data.get('principal')) * 10_000,
        riskLevel: risk,
        lowerAnnualPercent: Number(lower),
        upperAnnualPercent: Number(upper),
        startMonth: parseMonth(start),
        endMonthExclusive: addMonths(parseMonth(String(data.get('end'))), 1),
      };
      saveInvestmentScenario(plan, input);
      onChange((current) => saveInvestmentScenario(current, input));
      onClose();
    } catch (cause) {
      setError(
        cause instanceof InvestmentAllocationError &&
          cause.code === 'insufficient' &&
          availableAtStart !== null
          ? copy.investment.error_funds.replace(
              '{amount}',
              moneyFormatter(locale)(availableAtStart)
            )
          : copy.investment.error
      );
    }
  };
  return (
    <form
      onSubmit={submit}
      onChange={markPlanDraftChanged}
      className="max-w-2xl space-y-4"
      noValidate
    >
      <div className="grid min-w-0 gap-3 sm:grid-cols-[repeat(2,minmax(0,1fr))] [&>div]:min-w-0 [&>label]:min-w-0">
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
        <div className="grid min-w-0 grid-cols-[repeat(2,minmax(0,1fr))] gap-3 [&>label]:min-w-0">
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
            value={start}
            onChange={(event) => {
              setStart(event.target.value);
              setError('');
            }}
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
      {availableAtStart !== null && (
        <p className="text-muted-foreground text-xs leading-relaxed">
          {copy.investment.available_at_start.replace(
            '{amount}',
            moneyFormatter(locale)(availableAtStart)
          )}
        </p>
      )}
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
