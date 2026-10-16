'use client';

import { useMemo, useRef, useState, type FormEvent } from 'react';
import {
  safeCalculateMonthlyLifePlan,
  type MonthlyCalculationResult,
} from '@/features/life-ledger/calculation';
import { monthIndex, type LifePlan } from '@/features/life-ledger/domain';
import { writeQuickPlanHandoffV2 } from '@/features/life-ledger/storage';
import { useLocale } from 'next-intl';

import { useRouter } from '@/core/i18n/navigation';
import { defaultLocale } from '@/config/locale';
import { cn } from '@/shared/lib/utils';

import {
  createPersonalBaselineDraft,
  createPersonalBaselinePlan,
  parsePersonalBaselineDraft,
  PERSONAL_BASELINE_FIELDS,
  type PersonalBaselineDraft,
  type PersonalBaselineField,
  type PersonalBaselineInput,
  type PersonalBaselineIssue,
  type PersonalBaselineIssueCode,
} from './personal-baseline';
import { PersonalBaselineResult } from './personal-baseline-result';

export interface PersonalBaselineCalculatorConfig {
  id?: string;
  locale?: string;
  title: string;
  timeline_title: string;
  money_title: string;
  fields: {
    age: string;
    starting_assets: string;
    monthly_income: string;
    monthly_spend: string;
    retirement_spend: string;
    retire_age: string;
    end_age: string;
  };
  retirement_spend_hint: string;
  starting_assets_hint: string;
  units: {
    age: string;
    currency_month: string;
    currency: string;
    currency_ten_thousand: string;
  };
  p2_calculate: string;
  changed_hint: string;
  error_summary: string;
  error_messages: Record<
    | PersonalBaselineIssueCode
    | 'retirement-order'
    | 'end-order'
    | 'calculation',
    string
  >;
  p2_result_label: string;
  p2_result_ok: string;
  p2_result_gap: string;
  p2_result_recovered: string;
  p2_first_gap: string;
  p2_no_gap: string;
  p2_ending: string;
  p3_chart_title: string;
  p3_chart_hint: string;
  p3_chart_available: string;
  p3_chart_retirement: string;
  p3_chart_first_gap: string;
  p3_chart_table: string;
  p3_chart_year: string;
  p2_timeline_summary: string;
  assumptions_title: string;
  p2_assumptions: string;
  p2_estimate_note: string;
  continue_title: string;
  continue_description: string;
  continue_button: string;
}

interface Submission {
  draft: PersonalBaselineDraft;
  input: PersonalBaselineInput;
  plan: LifePlan;
  result: MonthlyCalculationResult;
}

type FieldDefinition = {
  key: PersonalBaselineField;
  label: string;
  unit: string;
  minimum: number;
  maximum: number;
  step: number;
  hint?: string;
  money?: boolean;
  canonicalUnit?: 'yuan' | 'wan';
};

export function PersonalBaselineCalculator({
  config,
}: {
  config: PersonalBaselineCalculatorConfig;
}) {
  const router = useRouter();
  const locale = useLocale();
  const formRef = useRef<HTMLFormElement>(null);
  const resultRef = useRef<HTMLElement>(null);
  const contextRef = useRef<{
    id: string;
    baseMonth: LifePlan['baseMonth'];
    nowIso: string;
  } | null>(null);
  const [draft, setDraft] = useState(createPersonalBaselineDraft);
  const [issues, setIssues] = useState<PersonalBaselineIssue[]>([]);
  const [calculationError, setCalculationError] = useState(false);
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [moneyUnits, setMoneyUnits] = useState<Record<string, 'yuan' | 'wan'>>({
    startingAvailableAssetsWan: 'wan',
    monthlyIncomeYuan: 'yuan',
    monthlyExpenseYuan: 'yuan',
    monthlyRetirementSelfFundedYuan: 'yuan',
  });

  const calculatorId = config.id || 'calculator';
  const issueByField = useMemo(
    () =>
      new Map(issues.map((issue) => [issue.field, issue] as const)) as Map<
        PersonalBaselineField,
        PersonalBaselineIssue
      >,
    [issues]
  );
  const isDirty = submission
    ? PERSONAL_BASELINE_FIELDS.some(
        (field) => draft[field] !== submission.draft[field]
      )
    : false;

  const timelineFields: FieldDefinition[] = [
    {
      key: 'currentAge',
      label: config.fields.age,
      unit: config.units.age,
      minimum: 18,
      maximum: 75,
      step: 1,
    },
    {
      key: 'retirementAge',
      label: config.fields.retire_age,
      unit: config.units.age,
      minimum: 19,
      maximum: 80,
      step: 1,
    },
    {
      key: 'endAge',
      label: config.fields.end_age,
      unit: config.units.age,
      minimum: 20,
      maximum: 120,
      step: 1,
    },
  ];
  const moneyFields: FieldDefinition[] = [
    {
      key: 'startingAvailableAssetsWan',
      label: config.fields.starting_assets,
      unit: config.units.currency_ten_thousand,
      minimum: 0,
      maximum: 100_000,
      step: 1,
      hint: config.starting_assets_hint,
      money: true,
      canonicalUnit: 'wan',
    },
    {
      key: 'monthlyIncomeYuan',
      label: config.fields.monthly_income,
      unit: config.units.currency_month,
      minimum: 0,
      maximum: 10_000_000,
      step: 100,
      money: true,
      canonicalUnit: 'yuan',
    },
    {
      key: 'monthlyExpenseYuan',
      label: config.fields.monthly_spend,
      unit: config.units.currency_month,
      minimum: 0,
      maximum: 10_000_000,
      step: 100,
      money: true,
      canonicalUnit: 'yuan',
    },
    {
      key: 'monthlyRetirementSelfFundedYuan',
      label: config.fields.retirement_spend,
      unit: config.units.currency_month,
      minimum: 0,
      maximum: 10_000_000,
      step: 100,
      hint: config.retirement_spend_hint,
      money: true,
      canonicalUnit: 'yuan',
    },
  ];

  const issueMessage = (issue: PersonalBaselineIssue) => {
    if (issue.code === 'age-order') {
      return issue.field === 'retirementAge'
        ? config.error_messages['retirement-order']
        : config.error_messages['end-order'];
    }
    return config.error_messages[issue.code];
  };

  const focusResult = () => {
    requestAnimationFrame(() => {
      const section = resultRef.current;
      if (!section) return;
      section.focus({ preventScroll: true });
      section.scrollIntoView({
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 'auto'
          : 'smooth',
        block: 'start',
      });
    });
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = parsePersonalBaselineDraft(draft);
    if (!parsed.ok) {
      setIssues(parsed.issues);
      setCalculationError(false);
      requestAnimationFrame(() => {
        formRef.current
          ?.querySelector<HTMLInputElement>('[aria-invalid="true"]')
          ?.focus();
      });
      return;
    }

    if (!contextRef.current) {
      const now = new Date();
      contextRef.current = {
        id: crypto.randomUUID(),
        baseMonth: monthIndex(now.getFullYear(), now.getMonth() + 1),
        nowIso: now.toISOString(),
      };
    }
    const plan = createPersonalBaselinePlan(parsed.input, contextRef.current);
    const calculated = safeCalculateMonthlyLifePlan(plan);
    if (!calculated.ok) {
      setCalculationError(true);
      return;
    }

    setIssues([]);
    setCalculationError(false);
    setSubmission({
      draft: { ...draft },
      input: parsed.input,
      plan,
      result: calculated.result,
    });
    focusResult();
  };

  const handleContinue = () => {
    if (!submission || isDirty) return;
    writeQuickPlanHandoffV2(
      submission.plan,
      submission.result.inputHash,
      window.sessionStorage
    );
    if (!navigator.onLine) {
      // A document navigation can use the prepared shell without an RSC fetch.
      window.location.assign(
        `${locale === defaultLocale ? '' : `/${locale}`}/plan?tab=plan`
      );
    } else {
      router.push('/plan?tab=plan');
    }
  };

  const renderField = ({
    key,
    label,
    unit,
    minimum,
    maximum,
    step,
    hint,
    money,
    canonicalUnit = 'yuan',
  }: FieldDefinition) => {
    const issue = issueByField.get(key);
    const errorId = `${calculatorId}-${key}-error`;
    const hintId = `${calculatorId}-${key}-hint`;
    const displayUnit = moneyUnits[key] ?? canonicalUnit;
    const canonicalFactor = canonicalUnit === 'wan' ? 10_000 : 1;
    const displayFactor = displayUnit === 'wan' ? 10_000 : 1;
    const displayValue =
      money && draft[key] !== ''
        ? String((Number(draft[key]) * canonicalFactor) / displayFactor)
        : draft[key];
    return (
      <label key={key} className="grid min-w-0 content-start gap-1.5">
        <span className="text-muted-foreground text-xs font-medium">
          {label}
        </span>
        <span
          className={cn(
            'bg-background flex h-12 items-center rounded-lg border px-3 transition-[border-color,box-shadow]',
            issue
              ? 'border-destructive focus-within:ring-destructive/15 focus-within:ring-3'
              : 'border-input focus-within:border-primary focus-within:ring-primary/15 focus-within:ring-3'
          )}
        >
          <input
            type="number"
            min={money ? (minimum * canonicalFactor) / displayFactor : minimum}
            max={money ? (maximum * canonicalFactor) / displayFactor : maximum}
            step={money && displayUnit === 'wan' ? 0.01 : step}
            inputMode={step === 1 ? 'numeric' : 'decimal'}
            value={displayValue}
            aria-invalid={Boolean(issue)}
            aria-describedby={issue ? errorId : hint ? hintId : undefined}
            onChange={(inputEvent) => {
              const value = inputEvent.target.value;
              const canonicalValue =
                money && value !== ''
                  ? String((Number(value) * displayFactor) / canonicalFactor)
                  : value;
              setDraft((current) => ({
                ...current,
                [key]: canonicalValue,
              }));
              setIssues((current) =>
                current.filter((currentIssue) => currentIssue.field !== key)
              );
              setCalculationError(false);
            }}
            className="text-foreground h-full min-w-0 flex-1 appearance-none border-0 bg-transparent text-base font-medium tabular-nums outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          {money ? (
            <select
              aria-label={locale.startsWith('zh') ? '金额单位' : 'Amount unit'}
              value={displayUnit}
              onChange={(event) =>
                setMoneyUnits((current) => ({
                  ...current,
                  [key]: event.target.value as 'yuan' | 'wan',
                }))
              }
              className="text-muted-foreground ml-1 shrink-0 bg-transparent text-[11px] outline-none"
            >
              <option value="yuan">
                {locale.startsWith('zh') ? '元' : 'CNY'}
                {key !== 'startingAvailableAssetsWan'
                  ? locale.startsWith('zh')
                    ? '/月'
                    : '/mo'
                  : ''}
              </option>
              <option value="wan">
                {locale.startsWith('zh') ? '万' : '10k CNY'}
                {key !== 'startingAvailableAssetsWan'
                  ? locale.startsWith('zh')
                    ? '/月'
                    : '/mo'
                  : ''}
              </option>
            </select>
          ) : (
            <span className="text-muted-foreground ml-1 shrink-0 text-[11px]">
              {unit}
            </span>
          )}
        </span>
        {issue && (
          <span
            id={errorId}
            className="text-destructive text-[11px] leading-relaxed"
          >
            {issueMessage(issue)}
          </span>
        )}
        {!issue && hint && (
          <span
            id={hintId}
            className="text-muted-foreground text-[11px] leading-relaxed"
          >
            {hint}
          </span>
        )}
      </label>
    );
  };

  return (
    <div
      id={calculatorId}
      className="border-border/80 bg-card relative overflow-hidden rounded-2xl border p-5 shadow-[0_24px_80px_-36px_color-mix(in_oklab,var(--color-primary)_35%,transparent)] sm:p-6"
    >
      <div className="bg-primary/80 absolute inset-x-0 top-0 h-1" />
      <h2 className="mb-5 text-lg font-semibold tracking-tight">
        {config.title}
      </h2>

      <form ref={formRef} onSubmit={handleSubmit} noValidate>
        <fieldset className="border-border/80 border-t pt-3">
          <legend className="text-foreground pr-2 text-xs font-semibold">
            {config.timeline_title}
          </legend>
          <div className="mt-1 grid grid-cols-1 items-start gap-3 min-[460px]:grid-cols-3">
            {timelineFields.map(renderField)}
          </div>
        </fieldset>

        <fieldset className="border-border/80 mt-5 border-t pt-3">
          <legend className="text-foreground pr-2 text-xs font-semibold">
            {config.money_title}
          </legend>
          <div className="mt-1 grid grid-cols-1 items-start gap-x-3 gap-y-4 sm:grid-cols-2">
            {moneyFields.map(renderField)}
          </div>
        </fieldset>

        {(issues.length > 0 || calculationError) && (
          <p
            className="text-destructive mt-4 text-xs leading-relaxed"
            role="alert"
          >
            {calculationError
              ? config.error_messages.calculation
              : config.error_summary}
          </p>
        )}

        <button
          type="submit"
          className="bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-primary/30 mt-5 flex min-h-12 w-full items-center justify-center rounded-lg px-4 text-sm font-semibold transition-[background-color,transform] focus-visible:ring-4 focus-visible:outline-none active:translate-y-px"
        >
          {config.p2_calculate}
        </button>

        <p
          className={cn(
            'mt-2 min-h-4 text-center text-xs transition-opacity',
            isDirty ? 'text-primary opacity-100' : 'opacity-0'
          )}
          aria-live="polite"
        >
          {isDirty ? config.changed_hint : ''}
        </p>
      </form>

      {submission && (
        <PersonalBaselineResult
          config={config}
          input={submission.input}
          result={submission.result}
          isDirty={isDirty}
          onContinue={handleContinue}
          sectionRef={resultRef}
        />
      )}
    </div>
  );
}
