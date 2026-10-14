'use client';

import { useState } from 'react';

import { basisPoints, yuan, type LifePlan } from '../../domain';

export function MoneyEditor({ label, value, locale, hint, onCommit }: any) {
  return (
    <div className="max-w-md">
      <NumberField
        label={label}
        value={value / 100}
        unit={locale === 'zh' ? '元/月' : 'CNY/mo'}
        onCommit={(next: number) => onCommit(yuan(next))}
      />
      {hint && (
        <p className="text-muted-foreground mt-2 text-xs leading-relaxed">
          {hint}
        </p>
      )}
    </div>
  );
}

export function CategoryEditor({
  category,
  bucket,
  label,
  locale,
  copy,
  onChange,
  onConfirm,
}: any) {
  const detail = bucket?.details?.find(
    (flow: any) => flow.category === category
  );
  const summary = bucket?.summary?.amountCents ?? 0;
  const total =
    bucket?.details?.reduce(
      (sum: number, flow: any) => sum + flow.amountCents,
      0
    ) ?? 0;
  return (
    <div className="max-w-xl">
      <MoneyEditor
        label={label}
        value={detail?.amountCents ?? 0}
        locale={locale}
        onCommit={onChange}
      />
      <div className="border-border mt-4 grid grid-cols-3 gap-4 border-t pt-4 text-xs">
        <div>
          <span className="text-muted-foreground">
            {copy.plan.original_total}
          </span>
          <strong className="mt-1 block tabular-nums">
            {moneyFormatter(locale)(summary)}
          </strong>
        </div>
        <div>
          <span className="text-muted-foreground">{copy.plan.classified}</span>
          <strong className="mt-1 block tabular-nums">
            {moneyFormatter(locale)(total)}
          </strong>
        </div>
        <div>
          <span className="text-muted-foreground">{copy.plan.unallocated}</span>
          <strong className="mt-1 block tabular-nums">
            {moneyFormatter(locale)(Math.max(0, summary - total))}
          </strong>
        </div>
      </div>
      {total > summary && bucket?.confirmedDetailedTotalCents !== total && (
        <button
          type="button"
          onClick={onConfirm}
          className="mt-4 inline-flex min-h-10 items-center rounded-lg bg-amber-600 px-3.5 text-sm font-semibold text-white hover:bg-amber-700"
        >
          {copy.plan.confirm_total}
        </button>
      )}
    </div>
  );
}

export function AdvancedEditor({ plan, copy, onChange }: any) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <NumberField
        label={copy.plan.return_rate}
        minimum={-99}
        maximum={100}
        value={plan.assumptions.annualLiquidReturnBps / 100}
        unit="%"
        step="0.1"
        onCommit={(value: number) =>
          onChange((current: LifePlan) => ({
            ...current,
            assumptions: {
              ...current.assumptions,
              annualLiquidReturnBps: basisPoints(Math.round(value * 100)),
            },
          }))
        }
      />
      <NumberField
        label={copy.plan.gap_rate}
        value={plan.assumptions.annualCashGapCostBps / 100}
        unit="%"
        step="0.1"
        onCommit={(value: number) =>
          onChange((current: LifePlan) => ({
            ...current,
            assumptions: {
              ...current.assumptions,
              annualCashGapCostBps: basisPoints(Math.round(value * 100)),
            },
          }))
        }
      />
    </div>
  );
}

export function NumberField(props: any) {
  return <NumberFieldInput key={props.value} {...props} />;
}

function NumberFieldInput({
  label,
  value,
  unit,
  step = '0.01',
  minimum = 0,
  maximum = 1_000_000_000,
  onCommit,
}: any) {
  const [draft, setDraft] = useState(String(value));
  return (
    <label className="block">
      <span className="text-muted-foreground mb-1.5 block text-xs font-medium">
        {label}
      </span>
      <span className="border-input bg-background focus-within:border-primary focus-within:ring-primary/15 flex h-11 items-center rounded-lg border px-3 focus-within:ring-3">
        <input
          type="number"
          inputMode="decimal"
          step={step}
          min={minimum}
          max={maximum}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => {
            const parsed = Number(draft);
            if (
              draft.trim() &&
              Number.isFinite(parsed) &&
              parsed >= minimum &&
              parsed <= maximum
            ) {
              if (parsed !== value) onCommit(parsed);
            } else setDraft(String(value));
          }}
          className="h-full min-w-0 flex-1 bg-transparent text-sm font-medium tabular-nums outline-none"
        />
        <span className="text-muted-foreground ml-2 text-xs">{unit}</span>
      </span>
    </label>
  );
}

export function moneyFormatter(locale: string) {
  const f = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
  return (cents: number) =>
    `${f.format(cents / 100)} ${locale.startsWith('zh') ? '元' : 'CNY'}`;
}
