'use client';

import { useState, type FormEvent } from 'react';

import { calculateMonthlyLifePlan } from '../../calculation';
import {
  addMonths,
  createLocalId,
  formatMonth,
  monthIndex,
  type Asset,
} from '../../domain';
import { requestPlanNavigation } from '../navigation';
import { moneyFormatter } from './fields';
import {
  estimateMortgage,
  removePurchase,
  savePurchase,
} from './housing-mutations';
import type { SectionProps } from './types';

type MoneyUnit = 'yuan' | 'wan';

function convertMoneyDraft(draft: string, from: MoneyUnit, to: MoneyUnit) {
  const parsed = Number(draft);
  if (!draft.trim() || !Number.isFinite(parsed)) return draft;
  const yuanValue = parsed * (from === 'wan' ? 10_000 : 1);
  return String(yuanValue / (to === 'wan' ? 10_000 : 1));
}

function MoneyUnitSelect({
  value,
  copy,
  onChange,
}: {
  value: MoneyUnit;
  copy: SectionProps['copy'];
  onChange: (value: MoneyUnit) => void;
}) {
  return (
    <select
      aria-label={copy.editor.amount_unit}
      value={value}
      onChange={(event) => onChange(event.target.value as MoneyUnit)}
      className="text-muted-foreground bg-transparent text-xs outline-none"
    >
      <option value="yuan">{copy.common.currency}</option>
      <option value="wan">{copy.editor.ten_thousand}</option>
    </select>
  );
}

const control =
  'border-input bg-background focus-visible:ring-primary/30 h-11 w-full min-w-0 rounded-lg border px-3 text-base focus-visible:ring-4 focus-visible:outline-none';
export function HousingCalculator(props: SectionProps) {
  const [editing, setEditing] = useState<string | null>(null);
  const c = props.copy.housing,
    purchases = props.plan.assets.filter((a) => a.purchase);
  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm leading-relaxed">{c.intro}</p>
      <ul className="divide-border divide-y">
        {purchases.map((a) => {
          const down = props.plan.standaloneCashFlows.find(
            (flow) => flow.id === a.purchase?.downPaymentFlowId
          );
          const loan = props.plan.liabilities.find(
            (item) => item.id === a.purchase?.liabilityId
          );
          return (
            <li
              key={a.id}
              className="flex flex-wrap items-center justify-between gap-3 py-3"
            >
              <div>
                <p className="text-sm font-semibold">
                  {a.name} · {formatMonth(a.acquiredMonth!)}
                </p>
                <p className="text-muted-foreground text-xs">
                  {c.price}{' '}
                  {moneyFormatter(props.locale)(a.openingBalanceCents)}
                  {' · '}
                  {c.deposit}{' '}
                  {moneyFormatter(props.locale)(down?.amountCents ?? 0)}
                  {loan
                    ? ` · ${c.monthly} ${moneyFormatter(props.locale)(loan.monthlyPaymentCents)}`
                    : ''}
                </p>
                <p className="text-muted-foreground mt-1 text-xs">
                  {c.deposit_deducted}
                </p>
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  className="min-h-11 text-sm hover:underline"
                  onClick={() => {
                    if (requestPlanNavigation()) setEditing(a.id);
                  }}
                >
                  {props.copy.editor.edit}
                </button>
                <button
                  type="button"
                  className="min-h-11 text-sm hover:underline"
                  onClick={() => {
                    if (window.confirm(c.remove_confirm)) {
                      props.onChange((p) => removePurchase(p, a.id));
                      setEditing(null);
                    }
                  }}
                >
                  {props.copy.editor.remove}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {editing !== null || purchases.length === 0 ? (
        <PurchaseForm
          key={editing ?? `new-${purchases.length}`}
          {...props}
          asset={purchases.find((a) => a.id === editing)}
          onClose={() => setEditing(null)}
        />
      ) : (
        <button
          type="button"
          className="border-primary/40 text-primary min-h-11 rounded-lg border px-4 text-sm"
          onClick={() => setEditing('new')}
        >
          {c.add}
        </button>
      )}
    </div>
  );
}

function PurchaseForm({
  asset,
  onClose,
  ...props
}: SectionProps & { asset?: Asset; onClose: () => void }) {
  const { plan, copy, locale, onChange } = props,
    c = copy.housing;
  const loan = plan.liabilities.find(
    (l) => l.id === asset?.purchase?.liabilityId
  );
  const down = plan.standaloneCashFlows.find(
    (f) => f.id === asset?.purchase?.downPaymentFlowId
  );
  const [price, setPrice] = useState(
    asset ? String(asset.openingBalanceCents / 1e6) : ''
  );
  const [priceUnit, setPriceUnit] = useState<'yuan' | 'wan'>('wan');
  const [deposit, setDeposit] = useState(
    asset ? String((down?.amountCents ?? 0) / 1e6) : ''
  );
  const [depositUnit, setDepositUnit] = useState<'yuan' | 'wan'>('wan');
  const [rate, setRate] = useState(
    loan ? String(loan.annualInterestBps / 100) : ''
  );
  const [years, setYears] = useState(
    loan ? String((loan.endMonthExclusive - loan.startMonth) / 12) : '30'
  );
  const [financed, setFinanced] = useState(asset ? !!loan : true);
  const [month, setMonth] = useState(
    formatMonth(asset?.acquiredMonth ?? plan.baseMonth)
  );
  const [draftId] = useState(() => asset?.id ?? createLocalId('housing'));
  const [error, setError] = useState(false);
  const priceYuan = Number(price) * (priceUnit === 'wan' ? 10_000 : 1);
  const depositYuan = Number(deposit) * (depositUnit === 'wan' ? 10_000 : 1);
  let estimate: ReturnType<typeof estimateMortgage> | null = null;
  let cashPreview:
    | {
        before: number;
        deposit: number;
        firstPayment: number;
        after: number;
      }
    | undefined;
  try {
    if (price !== '' && (!financed || (deposit !== '' && rate !== '')))
      estimate = estimateMortgage(
        priceYuan,
        financed ? depositYuan : priceYuan,
        financed ? Number(rate) : 0,
        financed ? Number(years) : 1
      );
  } catch {
    /* Incomplete input. */
  }
  try {
    if (estimate) {
      const [year, calendarMonth] = month.split('-').map(Number);
      const purchaseMonth = monthIndex(year, calendarMonth);
      const downPaymentYuan = financed ? depositYuan : priceYuan;
      const candidate = savePurchase(plan, {
        id: draftId,
        name: asset?.name ?? c.default_name,
        priceYuan,
        downPaymentYuan,
        annualRatePercent: financed ? Number(rate) : 0,
        years: financed ? Number(years) : 1,
        month: purchaseMonth,
      });
      const row = calculateMonthlyLifePlan(candidate).monthly.find(
        (value) => value.month === purchaseMonth
      );
      if (row)
        cashPreview = {
          before: row.openingAvailableCents,
          deposit: downPaymentYuan * 100,
          firstPayment: financed ? estimate.payment : 0,
          after: row.closingAvailableCents,
        };
    }
  } catch {
    /* Preview waits for a complete valid purchase. */
  }
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    try {
      if (!estimate) throw new Error('Incomplete');
      const [y, m] = String(data.get('month')).split('-').map(Number);
      const input = {
        id: draftId,
        name: String(data.get('name')).trim() || c.default_name,
        priceYuan,
        downPaymentYuan: financed ? depositYuan : priceYuan,
        annualRatePercent: financed ? Number(rate) : 0,
        years: financed ? Number(years) : 1,
        month: monthIndex(y, m),
      };
      savePurchase(plan, input);
      onChange((p) => savePurchase(p, input));
      onClose();
    } catch {
      setError(true);
    }
  };
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-2 text-sm">
          {copy.editor.optional_name}
          <input
            name="name"
            className={control}
            maxLength={80}
            defaultValue={asset?.name ?? ''}
            placeholder={c.default_name}
          />
        </label>
        <label className="grid gap-2 text-sm">
          {c.month}
          <input
            name="month"
            type="month"
            className={control}
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            min={formatMonth(plan.baseMonth)}
            max={formatMonth(addMonths(plan.endMonthExclusive, -1))}
          />
        </label>
        <label className="grid gap-2 text-sm">
          {c.price}
          <span className="border-input bg-background flex h-11 items-center rounded-lg border px-3">
            <input
              name="price"
              type="number"
              min="0.01"
              step="0.01"
              className="h-full min-w-0 flex-1 bg-transparent outline-none"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
            <MoneyUnitSelect
              value={priceUnit}
              copy={copy}
              onChange={(next) => {
                setPrice(convertMoneyDraft(price, priceUnit, next));
                setPriceUnit(next);
              }}
            />
          </span>
        </label>
        <label className="grid gap-2 text-sm">
          {c.payment_method}
          <select
            className={control}
            value={financed ? 'loan' : 'cash'}
            onChange={(e) => setFinanced(e.target.value === 'loan')}
          >
            <option value="loan">{c.loan}</option>
            <option value="cash">{c.cash}</option>
          </select>
        </label>
        {financed && (
          <>
            <label className="grid gap-2 text-sm">
              {c.deposit}
              <span className="border-input bg-background flex h-11 items-center rounded-lg border px-3">
                <input
                  name="deposit"
                  type="number"
                  min="0"
                  step="0.01"
                  className="h-full min-w-0 flex-1 bg-transparent outline-none"
                  value={deposit}
                  onChange={(e) => setDeposit(e.target.value)}
                />
                <MoneyUnitSelect
                  value={depositUnit}
                  copy={copy}
                  onChange={(next) => {
                    setDeposit(convertMoneyDraft(deposit, depositUnit, next));
                    setDepositUnit(next);
                  }}
                />
              </span>
            </label>
            <label className="grid gap-2 text-sm">
              {c.rate}
              <input
                name="rate"
                type="number"
                min="0"
                max="30"
                step="0.01"
                placeholder={c.rate_placeholder}
                className={control}
                value={rate}
                onChange={(e) => setRate(e.target.value)}
              />
            </label>
            <label className="grid gap-2 text-sm">
              {c.years}
              <input
                name="years"
                type="number"
                min="1"
                max="40"
                step="1"
                className={control}
                value={years}
                onChange={(e) => setYears(e.target.value)}
              />
            </label>
          </>
        )}
      </div>
      {estimate && (
        <dl
          aria-live="polite"
          className="bg-muted grid gap-3 rounded-lg p-4 sm:grid-cols-3"
        >
          {[
            [c.principal, estimate.principal],
            [c.monthly, estimate.payment],
            [c.interest, estimate.interest],
          ].map(([label, value]) => (
            <div key={String(label)}>
              <dt className="text-foreground text-xs">{label}</dt>
              <dd className="mt-1 font-semibold tabular-nums">
                {moneyFormatter(locale)(Number(value))}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {cashPreview && (
        <div className="border-border border-y py-4" aria-live="polite">
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[
              [c.cash_before, cashPreview.before],
              [c.deposit_deduction, -cashPreview.deposit],
              [c.first_payment, -cashPreview.firstPayment],
              [c.cash_after, cashPreview.after],
            ].map(([label, value]) => (
              <div key={String(label)}>
                <dt className="text-muted-foreground text-xs">{label}</dt>
                <dd className="mt-1 text-sm font-semibold tabular-nums">
                  {moneyFormatter(locale)(Number(value))}
                </dd>
              </div>
            ))}
          </dl>
          <p
            className={`mt-3 text-xs ${cashPreview.after < 0 ? 'text-destructive' : 'text-muted-foreground'}`}
          >
            {cashPreview.after < 0 ? c.cash_gap : c.cash_after_hint}
          </p>
        </div>
      )}
      <details className="text-xs">
        <summary className="text-muted-foreground cursor-pointer py-2">
          {c.explain}
        </summary>
        <p className="text-muted-foreground mt-1 leading-relaxed">
          {c.explanation}
        </p>
      </details>
      {error && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-300">
          {c.error}
        </p>
      )}
      <div className="flex gap-4">
        <button
          type="submit"
          className="bg-primary text-primary-foreground min-h-11 rounded-lg px-5 text-sm font-medium"
        >
          {copy.editor.save}
        </button>
        {(asset || plan.assets.some((a) => a.purchase)) && (
          <button
            type="button"
            className="min-h-11 text-sm"
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
