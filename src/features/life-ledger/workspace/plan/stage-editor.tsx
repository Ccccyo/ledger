'use client';

import { useState, type FormEvent } from 'react';
import { Trash2 } from 'lucide-react';

import { extractLifeTrajectory } from '../../analysis/extract-life-trajectory';
import {
  addMonths,
  cashFlowInputDirection,
  cashFlowSignedAmount,
  createLocalId,
  formatMonth,
  monthIndex,
  type CashFlowCategory,
  type CashFlowItem,
} from '../../domain';
import { markPlanDraftChanged, requestPlanNavigation } from '../navigation';
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
  const rows = plan.standaloneCashFlows.filter(
    (f) =>
      belongsToStage(plan, f, stage) &&
      !plan.assets.some((a) => a.purchase?.downPaymentFlowId === f.id)
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
                      {flow.name} ·{' '}
                      {moneyFormatter(locale)(cashFlowSignedAmount(flow))} ·{' '}
                      {copy.editor[flow.frequency.kind]}
                    </p>
                    <p className="text-muted-foreground mt-1 text-xs">
                      {formatMonth(flow.startMonth)}
                      {flow.frequency.kind !== 'once'
                        ? ' — ' +
                          formatMonth(addMonths(flow.endMonthExclusive, -1))
                        : ''}{' '}
                      · {copy.editor[cashFlowInputDirection(flow)]}
                    </p>
                  </div>
                  <div className="flex gap-4">
                    {
                      <button
                        type="button"
                        className={textButton}
                        onClick={() => {
                          if (requestPlanNavigation()) setEditing(flow.id);
                        }}
                      >
                        {copy.editor.edit}
                      </button>
                    }
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
          key={`new-${rows.length}`}
          {...props}
          stage={stage}
          onClose={() => setEditing(null)}
          onSkip={canSkip ? skip : undefined}
          allowCancel={rows.length > 0}
        />
      ) : (
        editing === null && (
          <div className="flex flex-wrap items-center gap-4">
            <button
              type="button"
              className="border-primary/40 text-primary hover:bg-primary/5 focus-visible:ring-primary/30 min-h-11 rounded-lg border px-4 text-sm font-medium focus-visible:ring-4 focus-visible:outline-none"
              onClick={() => setEditing('new')}
            >
              {stage === 'events'
                ? copy.editor.add_another_event
                : copy.editor.add_event}
            </button>
            <button
              type="button"
              className="text-muted-foreground hover:text-destructive focus-visible:ring-primary/30 inline-flex min-h-11 items-center gap-2 rounded-md px-2 text-sm focus-visible:ring-4 focus-visible:outline-none"
              onClick={() => {
                if (!window.confirm(copy.editor.clear_confirm)) return;
                const ids = new Set(rows.map((row) => row.id));
                onChange((current) => ({
                  ...current,
                  standaloneCashFlows: current.standaloneCashFlows.filter(
                    (flow) => !ids.has(flow.id)
                  ),
                }));
              }}
            >
              <Trash2 className="size-4" aria-hidden="true" />
              {copy.editor.clear_all}
            </button>
          </div>
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
    flow?.frequency.kind ?? (stage === 'events' ? 'once' : 'monthly')
  );
  const [direction, setDirection] = useState<'income' | 'expense'>(
    flow
      ? cashFlowInputDirection(flow)
      : stage === 'partner'
        ? 'income'
        : 'expense'
  );
  const [amountUnit, setAmountUnit] = useState<'yuan' | 'wan'>('yuan');
  const [amountDraft, setAmountDraft] = useState(
    flow ? String(cashFlowSignedAmount(flow) / 100) : ''
  );
  const [error, setError] = useState(false);
  const [name, setName] = useState(flow?.name ?? '');
  const presets = copy.editor.presets[stage] as Record<string, string>;
  const [preset, setPreset] = useState(
    Object.keys(presets).find((key) => presets[key] === flow?.name) ??
      (flow ? 'custom' : '')
  );
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
        id: flow?.id ?? createLocalId('flow'),
        name: String(
          name ||
            (stage === 'partner'
              ? copy.editor[`partner_${direction}`]
              : copy.plan.sections[stage])
        ),
        amountYuan:
          Number(data.get('amount')) * (amountUnit === 'wan' ? 10_000 : 1),
        start: parseMonth(start),
        end:
          frequency === 'once'
            ? plan.endMonthExclusive
            : addMonths(parseMonth(end), 1),
        frequency: frequency as 'once' | 'monthly' | 'yearly',
        direction,
      };
      saveStageEvent(plan, stage, input);
      onChange((p) => saveStageEvent(p, stage, input));
      onClose();
    } catch {
      setError(true);
    }
  };
  const label =
    frequency !== 'monthly'
      ? copy.editor.amount
      : direction === 'income'
        ? copy.editor.monthly_contribution
        : copy.editor.monthly_extra;
  return (
    <form onSubmit={submit} noValidate className="max-w-xl space-y-3">
      <div className="grid min-w-0 items-start gap-3 sm:grid-cols-[repeat(2,minmax(0,1fr))] [&>label]:min-w-0">
        <label
          className={`grid gap-1.5 text-sm ${stage === 'child' ? 'sm:col-span-2' : ''}`}
        >
          {copy.editor.project_name}
          <select
            className={control}
            name="preset"
            value={preset}
            onChange={(e) => {
              const key = e.target.value;
              setPreset(key);
              if (key && key !== 'custom') {
                setName(presets[key]);
                setFrequency(
                  ['travel', 'school'].includes(key)
                    ? 'yearly'
                    : [
                          'birth',
                          'second',
                          'study',
                          'car',
                          'gift',
                          'wedding',
                          'renovation',
                          'medical',
                          'repair',
                          'bonus',
                        ].includes(key)
                      ? 'once'
                      : 'monthly'
                );
                setDirection(
                  ['gift', 'support', 'rent_income', 'bonus'].includes(key)
                    ? 'income'
                    : 'expense'
                );
              }
              markPlanDraftChanged();
            }}
          >
            <option value="" disabled>
              {copy.editor.event_examples}
            </option>
            {Object.entries(presets).map(([key, title]) => (
              <option key={key} value={key}>
                {title}
              </option>
            ))}
            <option value="custom">{copy.editor.custom_name}</option>
          </select>
        </label>
        {stage !== 'child' && (
          <label className="grid gap-1.5 text-sm">
            {copy.editor.direction}
            <select
              className={control}
              value={direction}
              onChange={(e) => setDirection(e.target.value as typeof direction)}
            >
              {(['income', 'expense'] as const).map((value) => (
                <option key={value} value={value}>
                  {stage === 'partner'
                    ? copy.editor[`partner_${value}`]
                    : stage === 'parents'
                      ? copy.editor[`parents_${value}`]
                      : stage === 'housing'
                        ? copy.editor[`housing_${value}`]
                        : copy.editor[value]}
                </option>
              ))}
            </select>
          </label>
        )}
        {preset === 'custom' && (
          <label className="grid gap-1.5 text-sm sm:col-span-2">
            {copy.editor.optional_name}
            <input
              className={control}
              name="name"
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={copy.plan.sections[stage]}
            />
          </label>
        )}
        <label className="grid gap-1.5 text-sm">
          {label}
          <div className="border-input bg-background focus-within:ring-primary/30 flex h-11 min-w-0 items-center rounded-lg border px-3 focus-within:ring-4">
            <input
              name="amount"
              type="number"
              inputMode="decimal"
              required
              min="-1000000000"
              max="1000000000"
              step="0.01"
              aria-invalid={error}
              value={amountDraft}
              onChange={(event) => setAmountDraft(event.target.value)}
              placeholder="0"
              className="h-full min-w-0 flex-1 bg-transparent text-base tabular-nums outline-none"
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
              className="text-muted-foreground ml-2 max-w-[45%] shrink-0 bg-transparent text-xs outline-none"
            >
              <option value="yuan">
                {copy.common.currency}
                {frequency === 'monthly' ? copy.common.per_month : ''}
              </option>
              <option value="wan">
                {copy.editor.ten_thousand}
                {frequency === 'monthly' ? copy.common.per_month : ''}
              </option>
            </select>
          </div>
        </label>
        <label className="grid gap-1.5 text-sm">
          {copy.editor.frequency}
          <select
            className={control}
            value={frequency}
            onChange={(e) => setFrequency(e.target.value as typeof frequency)}
          >
            <option value="monthly">{copy.editor.monthly}</option>
            <option value="once">{copy.editor.once}</option>
            <option value="yearly">{copy.editor.yearly}</option>
          </select>
        </label>
        <label className="grid gap-1.5 text-sm">
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
        {frequency !== 'once' && (
          <label className="grid gap-1.5 text-sm">
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
      <p className="text-muted-foreground text-xs">{copy.editor.short_hint}</p>
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
          <button
            type="button"
            className={textButton}
            onClick={() => {
              if (requestPlanNavigation()) onClose();
            }}
          >
            {copy.editor.cancel}
          </button>
        )}
      </div>
    </form>
  );
}
