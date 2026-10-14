'use client';

import { useState, type FormEvent } from 'react';

import { extractLifeTrajectory } from '../../analysis/extract-life-trajectory';
import {
  addMonths,
  formatMonth,
  monthIndex,
  type CashFlowCategory,
  type CashFlowItem,
} from '../../domain';
import {
  belongsToStage,
  saveStageEvent,
  type EventStage,
} from './event-mutations';
import { CategoryEditor, moneyFormatter } from './fields';
import {
  confirmDetailedTotal,
  findBucket,
  updateCategoryDetail,
} from './plan-mutations';
import type { SectionProps } from './types';

const control =
  'border-input bg-background focus-visible:ring-primary/30 h-11 w-full min-w-0 rounded-lg border px-3 text-sm focus-visible:ring-4 focus-visible:outline-none';
const textButton =
  'text-muted-foreground hover:text-foreground focus-visible:ring-primary/30 min-h-11 rounded-sm px-1 text-sm underline-offset-4 hover:underline focus-visible:ring-4 focus-visible:outline-none';

export function StageEditor({
  stage,
  ...props
}: SectionProps & { stage: EventStage }) {
  const { plan, copy, locale, onChange } = props;
  const [editing, setEditing] = useState<string | null>(null);
  const rows = plan.standaloneCashFlows.filter((f) =>
    belongsToStage(plan, f, stage)
  );
  const node = extractLifeTrajectory(plan).find((n) => n.stage === stage);
  const excluded = node?.status === 'not-applicable';
  const canSkip =
    stage !== 'events' && node?.status !== 'complete' && rows.length === 0;
  const category: CashFlowCategory | null =
    stage === 'child'
      ? 'child'
      : stage === 'housing'
        ? 'housing'
        : stage === 'parents'
          ? 'parent'
          : null;
  const skip = () => {
    if (stage === 'events') return;
    onChange((p) => ({
      ...p,
      metadata: {
        ...p.metadata,
        excludedLifeStages: excluded
          ? p.metadata.excludedLifeStages?.filter((s) => s !== stage)
          : [...(p.metadata.excludedLifeStages ?? []), stage],
      },
    }));
  };
  if (excluded)
    return (
      <button type="button" className={textButton} onClick={skip}>
        {copy.editor.restore}
      </button>
    );
  return (
    <div className="space-y-4">
      {rows.length > 0 && (
        <ul className="divide-border divide-y">
          {rows.map((flow) => (
            <li key={flow.id} className="py-3 first:pt-0">
              {editing === flow.id ? (
                <EventForm
                  {...props}
                  stage={stage}
                  flow={flow}
                  onClose={() => setEditing(null)}
                />
              ) : (
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium break-words">
                      {flow.name} · {moneyFormatter(locale)(flow.amountCents)} ·{' '}
                      {copy.editor[flow.frequency.kind]}
                    </p>
                    <p className="text-muted-foreground mt-1 text-xs">
                      {formatMonth(flow.startMonth)}
                      {flow.frequency.kind === 'monthly'
                        ? ' — ' +
                          formatMonth(addMonths(flow.endMonthExclusive, -1))
                        : ''}{' '}
                      · {copy.editor[flow.direction]}
                    </p>
                  </div>
                  <div className="flex gap-4">
                    {flow.frequency.kind !== 'yearly' && (
                      <button
                        type="button"
                        className={textButton}
                        onClick={() => setEditing(flow.id)}
                      >
                        {copy.editor.edit}
                      </button>
                    )}
                    <button
                      type="button"
                      className={textButton}
                      onClick={() =>
                        onChange((p) => ({
                          ...p,
                          standaloneCashFlows: p.standaloneCashFlows.filter(
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
      {rows.length === 0 || editing === 'new' ? (
        <EventForm
          {...props}
          stage={stage}
          onClose={() => setEditing(null)}
          onSkip={canSkip ? skip : undefined}
          allowCancel={rows.length > 0}
        />
      ) : (
        editing === null && (
          <button
            type="button"
            className={textButton}
            onClick={() => setEditing('new')}
          >
            {copy.editor.add_event}
          </button>
        )
      )}
      {category && (
        <details className="border-border border-t pt-3">
          <summary className="text-muted-foreground cursor-pointer text-xs">
            {copy.editor.existing_split}
          </summary>
          <p className="text-muted-foreground my-3 text-xs leading-relaxed">
            {copy.editor.split_hint}
          </p>
          <CategoryEditor
            category={category}
            label={copy.plan.sections[stage]}
            bucket={findBucket(plan, 'working-expenses')}
            copy={copy}
            locale={locale}
            onChange={(v: number) =>
              onChange((p) => updateCategoryDetail(p, category, v))
            }
            onConfirm={() => onChange(confirmDetailedTotal)}
          />
        </details>
      )}
    </div>
  );
}

function EventForm({
  stage,
  flow,
  onClose,
  onSkip,
  allowCancel = true,
  ...props
}: SectionProps & {
  stage: EventStage;
  flow?: CashFlowItem;
  onClose: () => void;
  onSkip?: () => void;
  allowCancel?: boolean;
}) {
  const { plan, copy, onChange } = props;
  const [frequency, setFrequency] = useState(
    flow?.frequency.kind === 'once' ? 'once' : 'monthly'
  );
  const [direction, setDirection] = useState<'income' | 'expense'>(
    flow?.direction ?? (stage === 'partner' ? 'income' : 'expense')
  );
  const [advanced, setAdvanced] = useState(false);
  const [error, setError] = useState(false);
  const [start, setStart] = useState(
    formatMonth(flow?.startMonth ?? plan.baseMonth)
  );
  const [end, setEnd] = useState(
    formatMonth(addMonths(flow?.endMonthExclusive ?? plan.retirementMonth, -1))
  );
  const parseMonth = (value: string) => {
    const [y, m] = value.split('-').map(Number);
    return monthIndex(y, m);
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    try {
      const input = {
        id: flow?.id ?? crypto.randomUUID(),
        name: String(
          data.get('name') ||
            (stage === 'partner'
              ? copy.editor[`partner_${direction}`]
              : copy.plan.sections[stage])
        ),
        amountYuan: Number(data.get('amount')),
        start: parseMonth(start),
        end:
          frequency === 'once'
            ? plan.endMonthExclusive
            : addMonths(parseMonth(end), 1),
        frequency: frequency as 'once' | 'monthly',
        direction,
      };
      saveStageEvent(plan, stage, input);
      onChange((p) => saveStageEvent(p, stage, input));
      onClose();
    } catch {
      setError(true);
      setAdvanced(true);
    }
  };
  const label =
    frequency === 'once'
      ? copy.editor.amount
      : direction === 'income'
        ? copy.editor.monthly_contribution
        : copy.editor.monthly_extra;
  return (
    <form onSubmit={submit} noValidate className="max-w-xl space-y-3">
      {stage === 'partner' && (
        <fieldset className="mb-5">
          <legend className="sr-only">{copy.editor.direction}</legend>
          <div className="flex flex-wrap gap-2">
            {(['income', 'expense'] as const).map((value) => (
              <label key={value} className="cursor-pointer">
                <input
                  type="radio"
                  name="partner-direction"
                  value={value}
                  checked={direction === value}
                  onChange={() => setDirection(value)}
                  className="peer sr-only"
                />
                <span className="border-border text-muted-foreground peer-checked:border-primary peer-checked:text-primary peer-checked:bg-primary/5 peer-focus-visible:ring-primary/30 flex min-h-11 items-center rounded-lg border px-3 text-sm peer-focus-visible:ring-4">
                  {copy.editor[`partner_${value}`]}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <label className="block">
        <span className="mb-2 block text-sm font-medium">{label}</span>
        <div className="border-input bg-background focus-within:ring-primary/30 flex h-12 max-w-sm items-center rounded-lg border px-3 focus-within:ring-4">
          <input
            name="amount"
            type="number"
            inputMode="decimal"
            required
            min="0.01"
            max="1000000000"
            step="0.01"
            aria-invalid={error}
            defaultValue={flow ? flow.amountCents / 100 : ''}
            placeholder="0"
            className="h-full min-w-0 flex-1 bg-transparent text-lg tabular-nums outline-none"
          />
          <span className="text-muted-foreground text-xs">
            {copy.common.currency}
            {frequency === 'monthly' ? copy.common.per_month : ''}
          </span>
        </div>
      </label>
      <details
        open={advanced}
        onToggle={(event) => setAdvanced(event.currentTarget.open)}
      >
        <summary className="text-muted-foreground cursor-pointer py-1 text-xs">
          {copy.editor.more_settings}
        </summary>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <label className="grid gap-2 text-xs">
            {copy.editor.name}
            <input
              className={control}
              name="name"
              maxLength={80}
              defaultValue={flow?.name ?? ''}
              placeholder={
                stage === 'partner'
                  ? copy.editor[`partner_${direction}`]
                  : copy.plan.sections[stage]
              }
            />
          </label>
          <label className="grid gap-2 text-xs">
            {copy.editor.frequency}
            <select
              className={control}
              value={frequency}
              onChange={(e) => setFrequency(e.target.value)}
            >
              <option value="monthly">{copy.editor.monthly}</option>
              <option value="once">{copy.editor.once}</option>
            </select>
          </label>
          {stage === 'events' && (
            <label className="grid gap-2 text-xs">
              {copy.editor.direction}
              <select
                className={control}
                value={direction}
                onChange={(e) =>
                  setDirection(e.target.value as 'income' | 'expense')
                }
              >
                <option value="income">{copy.editor.income}</option>
                <option value="expense">{copy.editor.expense}</option>
              </select>
            </label>
          )}
          <label className="grid gap-2 text-xs">
            {copy.editor.start}
            <input
              className={control}
              type="month"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              min={formatMonth(plan.baseMonth)}
              max={formatMonth(addMonths(plan.endMonthExclusive, -1))}
            />
          </label>
          {frequency === 'monthly' && (
            <label className="grid gap-2 text-xs">
              {copy.editor.end}
              <input
                className={control}
                type="month"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                min={formatMonth(plan.baseMonth)}
                max={formatMonth(addMonths(plan.endMonthExclusive, -1))}
              />
            </label>
          )}
        </div>
      </details>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {copy.editor.event_error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-5 pt-1">
        <button
          type="submit"
          className="bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-primary/30 min-h-11 rounded-lg px-5 text-sm font-medium focus-visible:ring-4 focus-visible:outline-none"
        >
          {copy.editor.save}
        </button>
        {onSkip && (
          <button type="button" className={textButton} onClick={onSkip}>
            {copy.editor.skip}
          </button>
        )}
        {allowCancel && (
          <button type="button" className={textButton} onClick={onClose}>
            {copy.editor.cancel}
          </button>
        )}
      </div>
    </form>
  );
}
