'use client';

import { useState } from 'react';

import {
  addMonths,
  formatMonth,
  monthIndex,
  type CashFlowItem,
} from '../../../domain';
import { requestPlanNavigation } from '../../navigation';
import {
  salaryGrowthBps,
  saveCareerChange,
  type CareerKind,
} from '../career-mutations';
import { moneyFormatter } from '../fields';
import type { SectionProps } from '../types';
import { SalaryGrowthSection } from './salary-growth-section';

const control =
  'border-input bg-background focus-visible:ring-primary/30 h-11 w-full min-w-0 rounded-lg border px-3 text-sm focus-visible:ring-4 focus-visible:outline-none';
const action =
  'text-muted-foreground hover:text-foreground focus-visible:ring-primary/30 min-h-11 rounded-md px-2 text-sm hover:underline focus-visible:ring-4 focus-visible:outline-none';

export function CareerSection(props: SectionProps) {
  const { plan, copy, locale, onChange } = props;
  const [tab, setTab] = useState<'growth' | CareerKind>('growth');
  const [editing, setEditing] = useState<string | null>(null);
  const flows = plan.standaloneCashFlows.filter(
    (f) =>
      f.ownerId === plan.primaryMemberId &&
      ['salary', 'side_income'].includes(f.category) &&
      (tab === 'side_income'
        ? f.category === 'side_income'
        : tab === 'break'
          ? f.incomeTreatment && f.amountCents === 0
          : f.category === 'salary' && f.amountCents > 0)
  );
  return (
    <div>
      <div
        role="tablist"
        aria-label={copy.career.kind}
        className="border-border mb-6 flex flex-wrap gap-x-4 border-b"
      >
        {(['growth', 'salary', 'side_income', 'break'] as const).map(
          (value, index, values) => (
            <button
              key={value}
              type="button"
              role="tab"
              id={`career-tab-${value}`}
              aria-controls="career-content"
              aria-selected={tab === value}
              tabIndex={tab === value ? 0 : -1}
              onKeyDown={(event) => {
                if (
                  ['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)
                ) {
                  event.preventDefault();
                  const next =
                    event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? 3
                        : (index + (event.key === 'ArrowRight' ? 1 : 3)) % 4;
                  if (values[next] !== tab && !requestPlanNavigation()) return;
                  setTab(values[next]);
                  setEditing(null);
                  document
                    .getElementById(`career-tab-${values[next]}`)
                    ?.focus();
                }
              }}
              onClick={() => {
                if (value !== tab && !requestPlanNavigation()) return;
                setTab(value);
                setEditing(null);
              }}
              className="text-muted-foreground hover:text-foreground aria-selected:text-primary aria-selected:border-primary focus-visible:ring-primary/30 min-h-11 border-b-2 border-transparent px-1 text-sm focus-visible:ring-4 focus-visible:outline-none"
            >
              {copy.career[value]}
            </button>
          )
        )}
      </div>
      <div
        id="career-content"
        role="tabpanel"
        aria-labelledby={`career-tab-${tab}`}
      >
        {tab === 'growth' ? (
          <SalaryGrowthSection {...props} />
        ) : (
          <>
            {flows.length > 0 && (
              <ul className="divide-border mb-5 divide-y">
                {flows.map((flow) => (
                  <li key={flow.id} className="py-4 first:pt-0">
                    {editing === flow.id ? (
                      <CareerForm
                        {...props}
                        flow={flow}
                        kind={tab as CareerKind}
                        onClose={() => setEditing(null)}
                      />
                    ) : (
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium">
                            {flow.name} ·{' '}
                            {moneyFormatter(locale)(flow.amountCents)}
                            {copy.common.per_month}
                          </p>
                          <p className="text-muted-foreground mt-1 text-xs">
                            {formatMonth(flow.startMonth)} —{' '}
                            {formatMonth(addMonths(flow.endMonthExclusive, -1))}{' '}
                            ·{' '}
                            {flow.incomeTreatment
                              ? copy.career.replaces
                              : copy.career.additive}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            className={action}
                            onClick={() => setEditing(flow.id)}
                          >
                            {copy.editor.edit}
                          </button>
                          <button
                            type="button"
                            className={action}
                            onClick={() =>
                              onChange((p) => ({
                                ...p,
                                standaloneCashFlows:
                                  p.standaloneCashFlows.filter(
                                    (f) => f.id !== flow.id
                                  ),
                              }))
                            }
                          >
                            {copy.editor.remove}
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {flows.length === 0 || editing === 'new' ? (
              <CareerForm
                {...props}
                kind={tab as CareerKind}
                key={tab}
                onClose={() => setEditing(null)}
                canCancel={flows.length > 0}
              />
            ) : (
              editing === null && (
                <button
                  type="button"
                  className={action}
                  onClick={() => setEditing('new')}
                >
                  {copy.career.add}
                </button>
              )
            )}
          </>
        )}
      </div>
    </div>
  );
}

function CareerForm({
  flow,
  kind,
  onClose,
  canCancel = true,
  ...props
}: SectionProps & {
  flow?: CashFlowItem;
  kind: CareerKind;
  onClose: () => void;
  canCancel?: boolean;
}) {
  const { plan, copy, onChange } = props;
  const [error, setError] = useState(false);
  const [amountUnit, setAmountUnit] = useState<'yuan' | 'wan'>('yuan');
  const [amountDraft, setAmountDraft] = useState(
    flow ? String(flow.amountCents / 100) : ''
  );
  const parse = (value: FormDataEntryValue | null) => {
    const [y, m] = String(value).split('-').map(Number);
    return monthIndex(y, m);
  };
  return (
    <form
      className="max-w-xl space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        try {
          const input = {
            id: flow?.id ?? crypto.randomUUID(),
            kind,
            amount:
              kind === 'break'
                ? 0
                : Number(data.get('amount')) *
                  (amountUnit === 'wan' ? 10_000 : 1),
            start: parse(data.get('start')),
            end: addMonths(parse(data.get('end')), 1),
            name: String(data.get('name') || copy.career[kind]),
            annualGrowthPercent:
              kind === 'salary' ? Number(data.get('job-growth')) : undefined,
          };
          saveCareerChange(plan, input);
          onChange((p) => saveCareerChange(p, input));
          onClose();
        } catch {
          setError(true);
        }
      }}
    >
      <p className="text-muted-foreground text-sm leading-relaxed">
        {copy.career.hints[kind]}
      </p>
      {kind !== 'break' && (
        <label className="grid max-w-sm gap-2 text-sm">
          {kind === 'salary'
            ? copy.career.salary_amount
            : copy.career.side_amount}
          <span className="border-input bg-background focus-within:ring-primary/30 flex h-11 items-center rounded-lg border px-3 focus-within:ring-4">
            <input
              className="h-full min-w-0 flex-1 bg-transparent outline-none"
              name="amount"
              type="number"
              inputMode="decimal"
              required
              min="0.01"
              max="1000000000"
              step="0.01"
              value={amountDraft}
              onChange={(event) => setAmountDraft(event.target.value)}
              placeholder={copy.career.amount_placeholder}
            />
            <select
              aria-label={copy.editor.amount_unit}
              value={amountUnit}
              onChange={(event) => {
                const next = event.target.value as 'yuan' | 'wan';
                const parsed = Number(amountDraft);
                if (Number.isFinite(parsed) && amountDraft.trim()) {
                  const yuanValue =
                    parsed * (amountUnit === 'wan' ? 10_000 : 1);
                  setAmountDraft(
                    String(yuanValue / (next === 'wan' ? 10_000 : 1))
                  );
                }
                setAmountUnit(next);
              }}
              className="text-muted-foreground bg-transparent text-xs outline-none"
            >
              <option value="yuan">
                {copy.common.currency}
                {copy.common.per_month}
              </option>
              <option value="wan">
                {copy.editor.ten_thousand}
                {copy.common.per_month}
              </option>
            </select>
          </span>
        </label>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="grid min-w-0 gap-2 text-sm">
          {copy.editor.start}
          <input
            className={control}
            type="month"
            name="start"
            required
            min={formatMonth(plan.baseMonth)}
            max={formatMonth(
              addMonths(
                kind === 'side_income'
                  ? plan.endMonthExclusive
                  : plan.retirementMonth,
                -1
              )
            )}
            defaultValue={formatMonth(flow?.startMonth ?? plan.baseMonth)}
          />
        </label>
        <label className="grid min-w-0 gap-2 text-sm">
          {copy.editor.end}
          <input
            className={control}
            type="month"
            name="end"
            required
            min={formatMonth(plan.baseMonth)}
            max={formatMonth(
              addMonths(
                kind === 'side_income'
                  ? plan.endMonthExclusive
                  : plan.retirementMonth,
                -1
              )
            )}
            defaultValue={formatMonth(
              addMonths(flow?.endMonthExclusive ?? plan.retirementMonth, -1)
            )}
          />
        </label>
      </div>
      {kind === 'salary' && (
        <label className="grid max-w-sm gap-2 text-sm">
          {copy.career.job_growth}
          <input
            className={control}
            name="job-growth"
            type="number"
            step="0.1"
            min="-99"
            max="100"
            required
            defaultValue={
              (flow?.annualGrowthBps ?? salaryGrowthBps(plan)) / 100
            }
          />
        </label>
      )}
      <details>
        <summary className="text-muted-foreground cursor-pointer text-sm">
          {copy.career.note}
        </summary>
        <label className="mt-3 grid gap-2 text-sm">
          {copy.editor.name}
          <input
            className={control}
            name="name"
            maxLength={80}
            defaultValue={flow?.name ?? ''}
            placeholder={copy.career[kind]}
          />
        </label>
      </details>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {copy.career.error}
        </p>
      )}
      <div className="flex flex-wrap gap-4">
        <button
          type="submit"
          className="bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-primary/30 min-h-11 rounded-lg px-5 text-sm font-medium focus-visible:ring-4 focus-visible:outline-none"
        >
          {copy.editor.save}
        </button>
        {canCancel ? (
          <button type="button" className={action} onClick={onClose}>
            {copy.editor.cancel}
          </button>
        ) : (
          <button
            type="button"
            className={action}
            onClick={() =>
              onChange((p) => ({
                ...p,
                metadata: {
                  ...p.metadata,
                  excludedLifeStages: [
                    ...(p.metadata.excludedLifeStages ?? []).filter(
                      (s) => s !== 'career'
                    ),
                    'career',
                  ],
                },
              }))
            }
          >
            {copy.career.keep}
          </button>
        )}
      </div>
    </form>
  );
}
