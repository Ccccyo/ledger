'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { safeCalculateLifePlan } from '@/features/life-ledger/calculation';
import {
  clearQuickPlanHandoff,
  createLocalPlanDraft,
  readLocalPlanDraft,
  readQuickPlanHandoff,
  saveLocalPlanDraft,
  type LocalPlanDraft,
} from '@/features/life-ledger/storage';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronDown,
  HardDrive,
  ShieldCheck,
} from 'lucide-react';

import { Link, useRouter } from '@/core/i18n/navigation';
import { cn } from '@/shared/lib/utils';

type NewPlanCopy = Record<
  | 'title'
  | 'description'
  | 'loading'
  | 'imported'
  | 'saved'
  | 'draft_name'
  | 'back'
  | 'empty_title'
  | 'empty_description'
  | 'empty_action'
  | 'error_title'
  | 'error_description'
  | 'result_title'
  | 'result_description'
  | 'status_ok'
  | 'status_gap'
  | 'first_gap'
  | 'no_gap'
  | 'minimum_balance'
  | 'ending_balance'
  | 'required_income'
  | 'retirement_balance'
  | 'year_suffix'
  | 'age_suffix'
  | 'currency'
  | 'currency_month'
  | 'inputs_title'
  | 'current_age'
  | 'retirement_age'
  | 'end_age'
  | 'monthly_income'
  | 'working_expenses'
  | 'retirement_self_funded'
  | 'savings'
  | 'annual_title'
  | 'annual_description'
  | 'table_year'
  | 'table_phase'
  | 'table_income'
  | 'table_expenses'
  | 'table_balance'
  | 'phase_working'
  | 'phase_retired'
  | 'show_all'
  | 'versions'
  | 'next_title'
  | 'next_description',
  string
>;

type PageState =
  | { status: 'loading' }
  | { status: 'ready'; draft: LocalPlanDraft }
  | { status: 'empty' }
  | { status: 'error' };

export function PlanNewClient({
  locale,
  copy,
}: {
  locale: string;
  copy: NewPlanCopy;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialized = useRef(false);
  const [state, setState] = useState<PageState>({ status: 'loading' });

  useEffect(() => {
    const timer = setTimeout(() => {
    if (initialized.current) return;
    initialized.current = true;

    try {
      const draftId = searchParams.get('draft');
      if (draftId) {
        const draft = readLocalPlanDraft(draftId, window.localStorage);
        setState(draft ? { status: 'ready', draft } : { status: 'empty' });
        return;
      }

      if (searchParams.get('from') !== 'quick') {
        setState({ status: 'empty' });
        return;
      }

      const handoff = readQuickPlanHandoff(window.sessionStorage);
      if (!handoff.ok) {
        setState({ status: 'empty' });
        return;
      }

      const id = createDraftId();
      const draft = createLocalPlanDraft({
        id,
        name: copy.draft_name,
        input: handoff.handoff.input,
        source: 'landing-quick-estimate',
      });

      // Persist first. Temporary input is cleared only after the durable write succeeds.
      saveLocalPlanDraft(draft, window.localStorage);
      clearQuickPlanHandoff(window.sessionStorage);
      setState({ status: 'ready', draft });
      router.replace(`/plans/new?draft=${encodeURIComponent(id)}`, {
        scroll: false,
      });
    } catch {
      setState({ status: 'error' });
    }
    }, 0);
    return () => clearTimeout(timer);
  }, [copy.draft_name, router, searchParams]);

  if (state.status === 'loading') {
    return (
      <main className="container flex min-h-[calc(100vh-4rem)] items-center justify-center py-16">
        <p className="text-muted-foreground text-sm" role="status">
          {copy.loading}
        </p>
      </main>
    );
  }

  if (state.status === 'empty' || state.status === 'error') {
    const isError = state.status === 'error';
    return (
      <main className="container flex min-h-[calc(100vh-4rem)] items-center justify-center py-16">
        <section className="border-border bg-background w-full max-w-xl rounded-2xl border p-7 sm:p-10">
          <AlertTriangle className="size-6 text-amber-600" aria-hidden="true" />
          <h1 className="text-foreground mt-5 text-2xl font-semibold tracking-tight">
            {isError ? copy.error_title : copy.empty_title}
          </h1>
          <p className="text-muted-foreground mt-3 max-w-[58ch] text-sm leading-relaxed">
            {isError ? copy.error_description : copy.empty_description}
          </p>
          <Link
            href="/#calculator"
            className="bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-primary/30 mt-7 inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold focus-visible:ring-4 focus-visible:outline-none"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            {copy.empty_action}
          </Link>
        </section>
      </main>
    );
  }

  return <PlanDraftView locale={locale} copy={copy} draft={state.draft} />;
}

function PlanDraftView({
  locale,
  copy,
  draft,
}: {
  locale: string;
  copy: NewPlanCopy;
  draft: LocalPlanDraft;
}) {
  const calculation = useMemo(
    () => safeCalculateLifePlan(draft.input),
    [draft.input]
  );
  const number = useMemo(
    () =>
      new Intl.NumberFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
        maximumFractionDigits: 0,
      }),
    [locale]
  );

  if (!calculation.ok) {
    return (
      <main className="container py-12 sm:py-16">
        <p className="text-destructive">{copy.error_description}</p>
      </main>
    );
  }

  const { input, summary, annualCashFlow, versions } = calculation.result;
  const formatMoney = (value: number, monthly = false) =>
    `${number.format(Math.round(value))} ${monthly ? copy.currency_month : copy.currency}`;
  const formatTemplate = (
    template: string,
    values: Record<string, string | number>
  ) =>
    Object.entries(values).reduce(
      (text, [key, value]) => text.replaceAll(`{${key}}`, String(value)),
      template
    );

  const metrics = [
    {
      label: copy.first_gap,
      value:
        summary.firstDeficitYear === null
          ? copy.no_gap
          : `${summary.firstDeficitYear}${copy.year_suffix} · ${summary.firstDeficitAge}${copy.age_suffix}`,
    },
    {
      label: copy.minimum_balance,
      value: formatMoney(summary.minimumBalance),
    },
    {
      label: copy.ending_balance,
      value: formatMoney(summary.endingBalance),
    },
    {
      label: copy.required_income,
      value: formatMoney(summary.requiredMonthlyIncome, true),
    },
  ];

  const inputs = [
    [copy.current_age, `${input.currentAge}${copy.age_suffix}`],
    [copy.retirement_age, `${input.retirementAge}${copy.age_suffix}`],
    [copy.end_age, `${input.endAge}${copy.age_suffix}`],
    [copy.monthly_income, formatMoney(input.monthlyIncome, true)],
    [copy.working_expenses, formatMoney(input.monthlyWorkingExpenses, true)],
    [
      copy.retirement_self_funded,
      formatMoney(input.monthlyRetirementSelfFunded, true),
    ],
    [copy.savings, formatMoney(input.currentSavings)],
  ];

  return (
    <main className="container max-w-6xl py-10 sm:py-14">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-3xl">
          <div className="text-primary flex items-center gap-2 text-sm font-medium">
            <Check className="size-4" aria-hidden="true" />
            {copy.imported}
          </div>
          <h1 className="text-foreground mt-3 text-3xl font-semibold tracking-[-0.025em] sm:text-4xl">
            {copy.title}
          </h1>
          <p className="text-muted-foreground mt-3 max-w-[68ch] text-sm leading-relaxed sm:text-base">
            {copy.description}
          </p>
        </div>
        <Link
          href="/#calculator"
          className="border-border bg-background text-foreground hover:bg-muted focus-visible:ring-primary/30 inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-lg border px-3.5 text-sm font-medium focus-visible:ring-4 focus-visible:outline-none"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          {copy.back}
        </Link>
      </div>

      <div className="mt-9 grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.65fr)]">
        <section className="border-border bg-background overflow-hidden rounded-2xl border">
          <div className="p-6 sm:p-8">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-foreground text-xl font-semibold tracking-tight">
                  {copy.result_title}
                </h2>
                <p className="text-muted-foreground mt-2 max-w-[62ch] text-sm leading-relaxed">
                  {copy.result_description}
                </p>
              </div>
              <span
                className={cn(
                  'inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold',
                  summary.hasAnyDeficit
                    ? 'bg-amber-500/12 text-amber-800 dark:text-amber-300'
                    : 'bg-primary/10 text-primary'
                )}
              >
                <ShieldCheck className="size-3.5" aria-hidden="true" />
                {summary.hasAnyDeficit ? copy.status_gap : copy.status_ok}
              </span>
            </div>

            <dl className="border-border mt-7 grid border-t sm:grid-cols-2">
              {metrics.map((metric, index) => (
                <div
                  key={metric.label}
                  className={cn(
                    'border-border py-5',
                    index < 2 && 'border-b',
                    index % 2 === 0 ? 'sm:pr-6' : 'sm:border-l sm:pl-6',
                    index === 1 && 'max-sm:border-b',
                    index === 2 && 'max-sm:border-b'
                  )}
                >
                  <dt className="text-muted-foreground text-xs font-medium">
                    {metric.label}
                  </dt>
                  <dd className="text-foreground mt-1.5 text-lg font-semibold tracking-tight tabular-nums">
                    {metric.value}
                  </dd>
                </div>
              ))}
            </dl>

            <div className="border-border mt-1 flex items-center justify-between gap-4 border-t pt-5 text-sm">
              <span className="text-muted-foreground">
                {copy.retirement_balance}
              </span>
              <strong className="text-foreground font-semibold tabular-nums">
                {formatMoney(summary.projectedRetirementBalance)}
              </strong>
            </div>
          </div>

          <details className="border-border group border-t">
            <summary className="hover:bg-muted/50 focus-visible:ring-primary/30 flex cursor-pointer list-none items-center justify-between gap-4 px-6 py-4 text-sm font-semibold focus-visible:ring-4 focus-visible:outline-none sm:px-8 [&::-webkit-details-marker]:hidden">
              <span>
                {formatTemplate(copy.show_all, {
                  count: annualCashFlow.length,
                })}
              </span>
              <ChevronDown className="size-4 transition-transform group-open:rotate-180" />
            </summary>
            <div className="border-border overflow-x-auto border-t">
              <div className="px-6 pt-5 sm:px-8">
                <h3 className="text-foreground text-sm font-semibold">
                  {copy.annual_title}
                </h3>
                <p className="text-muted-foreground mt-1 text-xs">
                  {copy.annual_description}
                </p>
              </div>
              <table className="mt-4 w-full min-w-[42rem] text-left text-xs">
                <thead className="bg-muted/60 text-muted-foreground">
                  <tr>
                    {[
                      copy.table_year,
                      copy.table_phase,
                      copy.table_income,
                      copy.table_expenses,
                      copy.table_balance,
                    ].map((heading) => (
                      <th
                        key={heading}
                        className="px-6 py-3 font-medium first:sm:pl-8 last:sm:pr-8"
                      >
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-border divide-y">
                  {annualCashFlow.map((year) => (
                    <tr key={year.age} className="hover:bg-muted/35">
                      <td className="px-6 py-3 font-medium tabular-nums first:sm:pl-8">
                        {year.year} · {year.age}
                        {copy.age_suffix}
                      </td>
                      <td className="text-muted-foreground px-6 py-3">
                        {year.phase === 'working'
                          ? copy.phase_working
                          : copy.phase_retired}
                      </td>
                      <td className="px-6 py-3 tabular-nums">
                        {formatMoney(year.income)}
                      </td>
                      <td className="px-6 py-3 tabular-nums">
                        {formatMoney(year.expenses)}
                      </td>
                      <td className="px-6 py-3 text-right font-medium tabular-nums last:sm:pr-8">
                        {formatMoney(year.closingBalance)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </section>

        <aside className="space-y-6">
          <section className="border-border bg-background rounded-2xl border p-6">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-foreground text-sm font-semibold">
                {copy.inputs_title}
              </h2>
              <span className="text-primary inline-flex items-center gap-1 text-xs font-medium">
                <HardDrive className="size-3.5" aria-hidden="true" />
                {copy.saved}
              </span>
            </div>
            <dl className="divide-border mt-4 divide-y">
              {inputs.map(([label, value]) => (
                <div
                  key={label}
                  className="flex items-baseline justify-between gap-5 py-3 text-xs"
                >
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="text-foreground text-right font-medium tabular-nums">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="border-border bg-background rounded-2xl border p-6">
            <h2 className="text-foreground text-sm font-semibold">
              {copy.next_title}
            </h2>
            <p className="text-muted-foreground mt-2 text-xs leading-relaxed">
              {copy.next_description}
            </p>
          </section>
        </aside>
      </div>

      <p className="text-muted-foreground mt-7 text-center text-[11px] leading-relaxed">
        {formatTemplate(copy.versions, {
          calculation: versions.calculation,
          schema: versions.inputSchema,
          city: versions.cityData,
          education: versions.educationData,
        })}
      </p>
    </main>
  );
}

function createDraftId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `plan-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
