'use client';

import { useState, type FormEvent } from 'react';
import { ArrowRight, MapPin, Plus, Trash2 } from 'lucide-react';

import {
  createLocalId,
  formatMonth,
  monthIndex,
  type CashFlowItem,
  type RelocationPlan,
} from '../../domain';
import { markPlanDraftChanged, requestPlanNavigation } from '../navigation';
import {
  removeRelocation,
  saveRelocation,
  type RelocationInput,
} from './relocation-mutations';
import type { SectionProps } from './types';

const control =
  'border-input bg-background focus-visible:ring-primary/30 h-11 w-full min-w-0 rounded-lg border px-3 text-sm focus-visible:ring-4 focus-visible:outline-none';
const quietButton =
  'text-muted-foreground hover:text-foreground focus-visible:ring-primary/30 min-h-11 rounded-md px-2 text-sm focus-visible:ring-4 focus-visible:outline-none';

function linkedFlow(
  flows: CashFlowItem[],
  id: string | undefined
): CashFlowItem | undefined {
  return id ? flows.find((flow) => flow.id === id) : undefined;
}

function signedYuan(
  flow: CashFlowItem | undefined,
  positiveDirection: 'income' | 'expense'
) {
  if (!flow) return 0;
  const amount = flow.amountCents / 100;
  return flow.direction === positiveDirection ? amount : -amount;
}

export function RelocationEditor({
  focusId,
  ...props
}: SectionProps & { focusId?: string }) {
  const { plan, copy, onChange } = props;
  const items = plan.metadata.relocations ?? [];
  const [editing, setEditing] = useState<string | 'new' | null>(
    focusId && items.some((item) => item.id === focusId)
      ? focusId
      : items.length
        ? null
        : 'new'
  );

  return (
    <div className="space-y-5">
      <div className="bg-muted/35 border-border rounded-lg border px-4 py-3">
        <p className="text-sm font-medium">{copy.relocation.manual_title}</p>
        <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
          {copy.relocation.manual_hint}
        </p>
      </div>

      {items.length > 0 && (
        <ul className="divide-border divide-y">
          {items.map((item) => (
            <li key={item.id} className="py-4 first:pt-0">
              {editing === item.id ? (
                <RelocationForm
                  {...props}
                  item={item}
                  onClose={() => setEditing(null)}
                />
              ) : (
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 font-medium">
                      <MapPin className="text-primary size-4" aria-hidden="true" />
                      <span>{item.currentCity || copy.relocation.current_unknown}</span>
                      <ArrowRight
                        className="text-muted-foreground size-3.5"
                        aria-hidden="true"
                      />
                      <span>{item.targetCity}</span>
                    </p>
                    <p className="text-muted-foreground mt-1 text-xs tabular-nums">
                      {formatMonth(item.moveMonth)} ·{' '}
                      {copy.relocation.flow_count.replace(
                        '{count}',
                        String(
                          [
                            item.movingExpenseFlowId,
                            item.housingAdjustmentFlowId,
                            item.livingAdjustmentFlowId,
                            item.incomeAdjustmentFlowId,
                          ].filter(Boolean).length
                        )
                      )}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className={quietButton}
                      onClick={() => {
                        if (requestPlanNavigation()) setEditing(item.id);
                      }}
                    >
                      {copy.editor.edit}
                    </button>
                    <button
                      type="button"
                      className={`${quietButton} hover:text-destructive inline-flex items-center gap-1.5`}
                      onClick={() =>
                        onChange((current) => removeRelocation(current, item.id))
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
        <RelocationForm {...props} onClose={() => setEditing(null)} />
      ) : (
        editing === null && (
          <button
            type="button"
            className="border-primary/40 text-primary hover:bg-primary/5 focus-visible:ring-primary/30 inline-flex min-h-11 items-center gap-2 rounded-lg border px-4 text-sm font-medium focus-visible:ring-4 focus-visible:outline-none"
            onClick={() => setEditing('new')}
          >
            <Plus className="size-4" aria-hidden="true" />
            {copy.relocation.add}
          </button>
        )
      )}
    </div>
  );
}

function RelocationForm({
  plan,
  copy,
  onChange,
  item,
  onClose,
}: SectionProps & {
  item?: RelocationPlan;
  onClose: () => void;
}) {
  const flows = plan.standaloneCashFlows;
  const moving = linkedFlow(flows, item?.movingExpenseFlowId);
  const housing = linkedFlow(flows, item?.housingAdjustmentFlowId);
  const living = linkedFlow(flows, item?.livingAdjustmentFlowId);
  const income = linkedFlow(flows, item?.incomeAdjustmentFlowId);
  const [error, setError] = useState(false);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const [year, month] = String(data.get('moveMonth')).split('-').map(Number);
    const input: RelocationInput = {
      id: item?.id ?? createLocalId('relocation'),
      currentCity: String(data.get('currentCity')),
      targetCity: String(data.get('targetCity')),
      moveMonth: monthIndex(year, month),
      movingExpenseYuan: Number(data.get('movingExpense')),
      housingMonthlyChangeYuan: Number(data.get('housingChange')),
      livingMonthlyChangeYuan: Number(data.get('livingChange')),
      incomeMonthlyChangeYuan: Number(data.get('incomeChange')),
      flowNames: {
        moving: copy.relocation.flow_names.moving,
        housing: copy.relocation.flow_names.housing,
        living: copy.relocation.flow_names.living,
        income: copy.relocation.flow_names.income,
      },
    };
    try {
      saveRelocation(plan, input);
      onChange((current) => saveRelocation(current, input));
      onClose();
    } catch {
      setError(true);
    }
  };
  return (
    <form
      className="max-w-2xl space-y-4"
      onSubmit={submit}
      onChange={markPlanDraftChanged}
      noValidate
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1.5 text-sm">
          {copy.relocation.current_city}
          <input
            name="currentCity"
            maxLength={80}
            defaultValue={item?.currentCity ?? ''}
            placeholder={copy.relocation.optional}
            className={control}
          />
        </label>
        <label className="grid gap-1.5 text-sm">
          {copy.relocation.target_city}
          <input
            name="targetCity"
            required
            maxLength={80}
            defaultValue={item?.targetCity ?? ''}
            className={control}
          />
        </label>
        <label className="grid gap-1.5 text-sm">
          {copy.relocation.move_month}
          <input
            name="moveMonth"
            type="month"
            required
            min={formatMonth(plan.baseMonth)}
            max={formatMonth((plan.endMonthExclusive - 1) as typeof plan.baseMonth)}
            defaultValue={formatMonth(item?.moveMonth ?? plan.baseMonth)}
            className={control}
          />
        </label>
        <AmountField
          name="movingExpense"
          label={copy.relocation.moving_expense}
          hint={copy.relocation.once_hint}
          defaultValue={moving ? moving.amountCents / 100 : 0}
          min={0}
        />
        <AmountField
          name="housingChange"
          label={copy.relocation.housing_change}
          hint={copy.relocation.change_hint}
          defaultValue={signedYuan(housing, 'expense')}
        />
        <AmountField
          name="livingChange"
          label={copy.relocation.living_change}
          hint={copy.relocation.change_hint}
          defaultValue={signedYuan(living, 'expense')}
        />
        <AmountField
          name="incomeChange"
          label={copy.relocation.income_change}
          hint={copy.relocation.income_hint}
          defaultValue={signedYuan(income, 'income')}
        />
      </div>
      <p className="text-muted-foreground text-xs">
        {copy.relocation.zero_hint}
      </p>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {copy.relocation.error}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          className="bg-primary text-primary-foreground min-h-11 rounded-lg px-5 text-sm font-medium"
        >
          {copy.editor.save}
        </button>
        <button type="button" className={quietButton} onClick={onClose}>
          {copy.editor.cancel}
        </button>
      </div>
    </form>
  );
}

function AmountField({
  name,
  label,
  hint,
  defaultValue,
  min = -1_000_000_000,
}: {
  name: string;
  label: string;
  hint: string;
  defaultValue: number;
  min?: number;
}) {
  return (
    <label className="grid gap-1.5 text-sm">
      {label}
      <input
        name={name}
        type="number"
        inputMode="decimal"
        min={min}
        max={1_000_000_000}
        step="1"
        defaultValue={defaultValue}
        className={control}
      />
      <span className="text-muted-foreground text-xs leading-relaxed">
        {hint}
      </span>
    </label>
  );
}
