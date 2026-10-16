import {
  formatMonth,
  growMoney,
  moneyCents,
  monthlyRateFromAnnualBps,
  monthParts,
  resolveLifePlan,
  roundMoney,
  validateLifePlan,
  type CashFlowCategory,
  type CashFlowItem,
  type LifePlan,
  type MoneyCents,
  type MonthIndex,
  type ResolvedCashFlow,
} from '../domain';
import type {
  AnnualLedgerRow,
  CalculationTraceEntry,
  CategoryTotals,
  InfluenceResult,
  MonthlyCalculationErrorShape,
  MonthlyCalculationResult,
  MonthlyLedgerRow,
  RequiredIncomeResult,
  SafeMonthlyCalculationResult,
} from './monthly-types';

export const MONTHLY_CALCULATION_VERSIONS = Object.freeze({
  calculation: '2.2.0' as const,
  schema: '2.0.0' as const,
  data: '2026.10.0',
  rules: 'monthly-cashflow-housing-2026-10' as const,
});

export class LifeLedgerMonthlyCalculationError
  extends Error
  implements MonthlyCalculationErrorShape
{
  readonly name = 'LifeLedgerMonthlyCalculationError' as const;

  constructor(
    readonly code: MonthlyCalculationErrorShape['code'],
    message: string,
    readonly issues: MonthlyCalculationErrorShape['issues'] = []
  ) {
    super(message);
  }
}

interface Simulation {
  monthly: MonthlyLedgerRow[];
  traces: CalculationTraceEntry[];
}

function addMoney(...values: number[]): MoneyCents {
  return moneyCents(values.reduce((total, value) => total + value, 0));
}

function addCategory(
  totals: CategoryTotals,
  category: CashFlowCategory,
  amount: MoneyCents
) {
  totals[category] = addMoney(totals[category] ?? 0, amount);
}

function occurs(flow: CashFlowItem, month: MonthIndex) {
  if (month < flow.startMonth || month >= flow.endMonthExclusive) return false;
  if (flow.frequency.kind === 'monthly') return true;
  if (flow.frequency.kind === 'once')
    return flow.frequency.postingMonth === month;
  return monthParts(month).month === flow.frequency.postingMonth;
}

function amountAt(flow: CashFlowItem, month: MonthIndex) {
  const growthStart = flow.growthStartMonth ?? flow.startMonth;
  const growthEnd = flow.growthEndMonthExclusive ?? flow.endMonthExclusive;
  const elapsedGrowthMonths = Math.max(
    0,
    Math.min(month, growthEnd) - growthStart
  );
  return growMoney(flow.amountCents, flow.annualGrowthBps, elapsedGrowthMonths);
}

function effectiveFlowsAt(
  plan: LifePlan,
  flows: ResolvedCashFlow[],
  month: MonthIndex
) {
  const active = flows.filter((flow) => occurs(flow, month));
  const replacements = active.filter(
    (flow) => flow.incomeTreatment === 'replace-salary'
  );
  const replacement =
    replacements.find((flow) => flow.amountCents === 0) ?? replacements[0];
  if (!replacement) return active;
  return active.filter(
    (flow) =>
      flow.id === replacement.id ||
      !(
        flow.direction === 'income' &&
        flow.ownerId === plan.primaryMemberId &&
        flow.category === 'salary'
      )
  );
}

function ageAt(plan: LifePlan, month: MonthIndex) {
  const member = plan.members.find(
    (value) => value.id === plan.primaryMemberId
  );
  return member?.birthMonth === undefined
    ? null
    : Math.max(0, Math.floor((month - member.birthMonth) / 12));
}

function simulate(
  plan: LifePlan,
  flows: ResolvedCashFlow[],
  monthlyIncomeSupplementCents: MoneyCents = moneyCents(0)
): Simulation {
  let available = moneyCents(
    plan.assets
      .filter((asset) => asset.liquid)
      .reduce((total, asset) => total + asset.openingBalanceCents, 0)
  );
  const nonLiquid = new Map(
    plan.assets
      .filter((asset) => !asset.liquid)
      .map(
        (asset) =>
          [
            asset.id,
            asset.acquiredMonth !== undefined &&
            asset.acquiredMonth > plan.baseMonth
              ? moneyCents(0)
              : asset.openingBalanceCents,
          ] as const
      )
  );
  const debts = new Map(
    plan.liabilities.map(
      (liability) =>
        [
          liability.id,
          liability.originatesAtStart && liability.startMonth > plan.baseMonth
            ? moneyCents(0)
            : liability.openingPrincipalCents,
        ] as const
    )
  );
  const monthly: MonthlyLedgerRow[] = [];
  const traces: CalculationTraceEntry[] = [];
  const liquidNegativeRate = monthlyRateFromAnnualBps(
    plan.assumptions.annualCashGapCostBps
  );

  for (
    let rawMonth: number = plan.baseMonth;
    rawMonth < plan.endMonthExclusive;
    rawMonth += 1
  ) {
    const month = rawMonth as MonthIndex;
    const traceIds: string[] = [];
    const incomeByCategory: CategoryTotals = {};
    const expenseByCategory: CategoryTotals = {};
    const openingAvailable = available;
    const liquidReturn = roundMoney(
      openingAvailable * (openingAvailable >= 0 ? 0 : liquidNegativeRate)
    );
    if (liquidReturn !== 0) {
      const id = `month:${month}:liquid-return`;
      traces.push({
        id,
        month,
        kind: 'liquid-return',
        rule:
          openingAvailable >= 0
            ? 'compound-liquid-balance-monthly'
            : 'compound-cash-gap-monthly',
        amountCents: liquidReturn,
      });
      traceIds.push(id);
    }

    let income = moneyCents(0);
    let expenses = moneyCents(0);
    for (const flow of effectiveFlowsAt(plan, flows, month)) {
      const amount = amountAt(flow, month);
      if (flow.direction === 'income') {
        income = addMoney(income, amount);
        addCategory(incomeByCategory, flow.category, amount);
      } else {
        expenses = addMoney(expenses, amount);
        addCategory(expenseByCategory, flow.category, amount);
      }
      const id = `month:${month}:flow:${flow.id}`;
      traces.push({
        id,
        month,
        kind: 'cash-flow',
        inputId: flow.id,
        sourceKind: flow.source.kind,
        rule: `post-${flow.frequency.kind}-cash-flow`,
        amountCents: amount,
      });
      traceIds.push(id);
    }

    if (month < plan.retirementMonth && monthlyIncomeSupplementCents > 0) {
      income = addMoney(income, monthlyIncomeSupplementCents);
      addCategory(incomeByCategory, 'other', monthlyIncomeSupplementCents);
      const id = `month:${month}:required-income-supplement`;
      traces.push({
        id,
        month,
        kind: 'income-supplement',
        rule: 'required-income-solver-working-months-only',
        amountCents: monthlyIncomeSupplementCents,
      });
      traceIds.push(id);
    }

    let debtBalance = moneyCents(0);
    for (const liability of plan.liabilities) {
      let principal = debts.get(liability.id) ?? moneyCents(0);
      if (
        liability.originatesAtStart &&
        month === liability.startMonth &&
        month > plan.baseMonth
      )
        principal = liability.openingPrincipalCents;
      if (
        principal > 0 &&
        month >= liability.startMonth &&
        month < liability.endMonthExclusive
      ) {
        const interest = roundMoney(
          principal *
            (liability.interestMethod === 'nominal-monthly'
              ? liability.annualInterestBps / 120_000
              : monthlyRateFromAnnualBps(liability.annualInterestBps))
        );
        const payable = addMoney(principal, interest);
        const payment = moneyCents(
          Math.min(
            payable,
            liability.originatesAtStart &&
              month === liability.endMonthExclusive - 1
              ? payable
              : liability.monthlyPaymentCents
          )
        );
        principal = addMoney(payable, -payment);
        expenses = addMoney(expenses, payment);
        addCategory(
          expenseByCategory,
          liability.kind === 'mortgage' ? 'housing' : 'other',
          payment
        );
        if (interest > 0) {
          const id = `month:${month}:debt-interest:${liability.id}`;
          traces.push({
            id,
            month,
            kind: 'debt-interest',
            inputId: liability.id,
            sourceKind: liability.source.kind,
            rule: 'compound-outstanding-principal-monthly',
            amountCents: interest,
          });
          traceIds.push(id);
        }
        if (payment > 0) {
          const id = `month:${month}:debt-payment:${liability.id}`;
          traces.push({
            id,
            month,
            kind: 'debt-payment',
            inputId: liability.id,
            sourceKind: liability.source.kind,
            rule: 'scheduled-payment-capped-at-balance',
            amountCents: payment,
          });
          traceIds.push(id);
        }
      }
      debts.set(liability.id, principal);
      debtBalance = addMoney(debtBalance, principal);
    }

    let nonLiquidAssets = moneyCents(0);
    for (const asset of plan.assets.filter((value) => !value.liquid)) {
      const opening =
        asset.acquiredMonth === month && month > plan.baseMonth
          ? asset.openingBalanceCents
          : (nonLiquid.get(asset.id) ?? moneyCents(0));
      const assetReturn = moneyCents(0);
      const closing = addMoney(opening, assetReturn);
      nonLiquid.set(asset.id, closing);
      nonLiquidAssets = addMoney(nonLiquidAssets, closing);
      if (assetReturn !== 0) {
        const id = `month:${month}:asset-return:${asset.id}`;
        traces.push({
          id,
          month,
          kind: 'asset-return',
          inputId: asset.id,
          sourceKind: asset.source.kind,
          rule: 'compound-non-liquid-asset-monthly',
          amountCents: assetReturn,
        });
        traceIds.push(id);
      }
    }

    const netCashFlow = addMoney(income, -expenses);
    available = addMoney(openingAvailable, liquidReturn, netCashFlow);
    const netWorth = addMoney(available, nonLiquidAssets, -debtBalance);
    monthly.push({
      month,
      year: monthParts(month).year,
      age: ageAt(plan, month),
      phase: month < plan.retirementMonth ? 'working' : 'retired',
      openingAvailableCents: openingAvailable,
      incomeCents: income,
      expenseCents: expenses,
      liquidReturnCents: liquidReturn,
      netCashFlowCents: netCashFlow,
      closingAvailableCents: available,
      nonLiquidAssetsCents: nonLiquidAssets,
      debtBalanceCents: debtBalance,
      netWorthCents: netWorth,
      incomeByCategory,
      expenseByCategory,
      traceIds,
    });
  }

  return { monthly, traces };
}

function mergeCategories(
  rows: MonthlyLedgerRow[],
  key: 'incomeByCategory' | 'expenseByCategory'
) {
  const result: CategoryTotals = {};
  for (const row of rows) {
    for (const [category, amount] of Object.entries(row[key])) {
      addCategory(result, category as CashFlowCategory, amount as MoneyCents);
    }
  }
  return result;
}

export function aggregateAnnualLedger(
  monthly: MonthlyLedgerRow[]
): AnnualLedgerRow[] {
  const years = new Map<number, MonthlyLedgerRow[]>();
  monthly.forEach((row) =>
    years.set(row.year, [...(years.get(row.year) ?? []), row])
  );
  return [...years.entries()].map(([year, rows]) => {
    const first = rows[0];
    const last = rows.at(-1)!;
    return {
      year,
      ageStart: first.age,
      ageEnd: last.age,
      phase: first.phase === last.phase ? first.phase : 'transition',
      openingAvailableCents: first.openingAvailableCents,
      incomeCents: addMoney(...rows.map((row) => row.incomeCents)),
      expenseCents: addMoney(...rows.map((row) => row.expenseCents)),
      liquidReturnCents: addMoney(...rows.map((row) => row.liquidReturnCents)),
      netCashFlowCents: addMoney(...rows.map((row) => row.netCashFlowCents)),
      closingAvailableCents: last.closingAvailableCents,
      minimumAvailableCents: moneyCents(
        Math.min(
          first.openingAvailableCents,
          ...rows.map((row) => row.closingAvailableCents)
        )
      ),
      closingNonLiquidAssetsCents: last.nonLiquidAssetsCents,
      closingDebtBalanceCents: last.debtBalanceCents,
      closingNetWorthCents: last.netWorthCents,
      incomeByCategory: mergeCategories(rows, 'incomeByCategory'),
      expenseByCategory: mergeCategories(rows, 'expenseByCategory'),
    };
  });
}

function meetsCriterion(
  simulation: Simulation,
  criterion: 'endpoint' | 'no-gap'
) {
  if (criterion === 'endpoint') {
    return (simulation.monthly.at(-1)?.closingAvailableCents ?? 0) >= 0;
  }
  return simulation.monthly.every((row) => row.closingAvailableCents >= 0);
}

function solveSupplement(
  plan: LifePlan,
  flows: ResolvedCashFlow[],
  criterion: 'endpoint' | 'no-gap'
): MoneyCents {
  if (meetsCriterion(simulate(plan, flows), criterion)) return moneyCents(0);
  let low = 0;
  let high = 100_00;
  const limit = 100_000_000_00;
  while (
    !meetsCriterion(simulate(plan, flows, moneyCents(high)), criterion) &&
    high < limit
  ) {
    high *= 2;
  }
  if (
    high >= limit &&
    !meetsCriterion(simulate(plan, flows, moneyCents(high)), criterion)
  ) {
    throw new LifeLedgerMonthlyCalculationError(
      'NON_CONVERGENT_RESULT',
      `Unable to solve the ${criterion} monthly income requirement.`
    );
  }
  while (low + 1 < high) {
    const midpoint = Math.floor((low + high) / 2);
    if (meetsCriterion(simulate(plan, flows, moneyCents(midpoint)), criterion))
      high = midpoint;
    else low = midpoint;
  }
  return moneyCents(high);
}

function recurringIncomeAtBase(
  plan: LifePlan,
  flows: ResolvedCashFlow[],
  month: MonthIndex
) {
  return moneyCents(
    effectiveFlowsAt(plan, flows, month)
      .filter((flow) => flow.direction === 'income' && occurs(flow, month))
      .reduce((total, flow) => total + amountAt(flow, month), 0)
  );
}

function requiredIncome(
  plan: LifePlan,
  flows: ResolvedCashFlow[]
): RequiredIncomeResult {
  const baseline = recurringIncomeAtBase(plan, flows, plan.baseMonth);
  const endpoint = solveSupplement(plan, flows, 'endpoint');
  const noGap = solveSupplement(plan, flows, 'no-gap');
  return {
    endpointZeroMonthlyIncomeCents: addMoney(baseline, endpoint),
    endpointZeroSupplementCents: endpoint,
    noGapMonthlyIncomeCents: addMoney(baseline, noGap),
    noGapSupplementCents: noGap,
  };
}

function cloneWithPerturbation(
  plan: LifePlan,
  type: 'flow' | 'asset' | 'liability',
  id: string
): LifePlan {
  const increase = (value: MoneyCents) => roundMoney(value * 1.1);
  const sourceAsset =
    type === 'asset' ? plan.assets.find((asset) => asset.id === id) : undefined;
  const perturbedAssetBalance = sourceAsset
    ? increase(sourceAsset.openingBalanceCents)
    : undefined;
  return {
    ...plan,
    cashFlowBuckets: plan.cashFlowBuckets.map((bucket) => ({
      ...bucket,
      summary:
        type === 'flow' && bucket.summary?.id === id
          ? {
              ...bucket.summary,
              amountCents: increase(bucket.summary.amountCents),
            }
          : bucket.summary,
      details: bucket.details.map((flow) =>
        type === 'flow' && flow.id === id
          ? { ...flow, amountCents: increase(flow.amountCents) }
          : flow
      ),
      confirmedDetailedTotalCents:
        bucket.confirmedDetailedTotalCents === undefined
          ? undefined
          : moneyCents(
              bucket.details
                .map((flow) =>
                  type === 'flow' && flow.id === id
                    ? increase(flow.amountCents)
                    : flow.amountCents
                )
                .reduce((total, value) => total + value, 0)
            ),
    })),
    standaloneCashFlows: plan.standaloneCashFlows.map((flow) =>
      type === 'flow' && flow.id === id
        ? { ...flow, amountCents: increase(flow.amountCents) }
        : flow
    ),
    assets: plan.assets.map((asset) =>
      type === 'asset' && asset.id === id
        ? { ...asset, openingBalanceCents: perturbedAssetBalance! }
        : asset
    ),
    liabilities: plan.liabilities.map((liability) =>
      type === 'liability' && liability.id === id
        ? {
            ...liability,
            openingPrincipalCents: increase(liability.openingPrincipalCents),
          }
        : liability
    ),
    metadata: {
      ...plan.metadata,
      investmentScenarios: plan.metadata.investmentScenarios?.map((scenario) =>
        scenario.assetId === id && perturbedAssetBalance !== undefined
          ? { ...scenario, principalCents: perturbedAssetBalance }
          : scenario
      ),
    },
  };
}

function calculateInfluences(
  plan: LifePlan,
  baselineEnding: MoneyCents
): InfluenceResult[] {
  const baselineResolved = resolveLifePlan(plan);
  const candidates = [
    ...baselineResolved.cashFlows.map((flow) => ({
      type: 'flow' as const,
      id: flow.id,
      label: flow.name,
    })),
    ...plan.assets.map((asset) => ({
      type: 'asset' as const,
      id: asset.id,
      label: asset.name,
    })),
    ...plan.liabilities.map((liability) => ({
      type: 'liability' as const,
      id: liability.id,
      label: liability.name,
    })),
  ];
  return candidates
    .map((candidate) => {
      const perturbed =
        candidate.type === 'flow'
          ? plan
          : cloneWithPerturbation(plan, candidate.type, candidate.id);
      const flows =
        candidate.type === 'flow'
          ? baselineResolved.cashFlows.map((flow) =>
              flow.id === candidate.id
                ? { ...flow, amountCents: roundMoney(flow.amountCents * 1.1) }
                : flow
            )
          : resolveLifePlan(perturbed).cashFlows;
      const ending =
        simulate(perturbed, flows).monthly.at(-1)?.closingAvailableCents ??
        moneyCents(0);
      const delta = addMoney(ending, -baselineEnding);
      return {
        inputId: candidate.id,
        label: candidate.label,
        perturbation: '金额增加 10%',
        endingAvailableDeltaCents: delta,
        absoluteImpactCents: moneyCents(Math.abs(delta)),
      };
    })
    .sort(
      (left, right) =>
        right.absoluteImpactCents - left.absoluteImpactCents ||
        left.inputId.localeCompare(right.inputId)
    )
    .slice(0, 3);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function inputHash(plan: LifePlan) {
  const text = stableStringify(plan);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function calculateMonthlyLifePlan(
  plan: LifePlan
): MonthlyCalculationResult {
  const validation = validateLifePlan(plan);
  if (!validation.valid) {
    throw new LifeLedgerMonthlyCalculationError(
      'INVALID_PLAN',
      'The life plan contains invalid or unconfirmed data.',
      validation.issues
    );
  }
  const resolved = resolveLifePlan(plan);
  const simulation = simulate(plan, resolved.cashFlows);
  const annual = aggregateAnnualLedger(simulation.monthly);
  const finalRow = simulation.monthly.at(-1)!;
  const firstGap = simulation.monthly.find(
    (row) => row.closingAvailableCents < 0
  );
  const minimum = Math.min(
    simulation.monthly[0]?.openingAvailableCents ?? 0,
    ...simulation.monthly.map((row) => row.closingAvailableCents)
  );
  const retirementRow = simulation.monthly.find(
    (row) => row.month === plan.retirementMonth
  );
  const required = requiredIncome(plan, resolved.cashFlows);
  const topInfluences = calculateInfluences(
    plan,
    finalRow.closingAvailableCents
  );

  return {
    input: plan,
    inputHash: inputHash(plan),
    inputSummary: {
      planId: plan.id,
      baseMonth: plan.baseMonth,
      endMonthExclusive: plan.endMonthExclusive,
      flowCount: resolved.cashFlows.length,
      assetCount: plan.assets.length,
      liabilityCount: plan.liabilities.length,
    },
    monthly: simulation.monthly,
    annual,
    summary: {
      hasAnyGap: Boolean(firstGap),
      firstGapMonth: firstGap?.month ?? null,
      firstGapYear: firstGap?.year ?? null,
      minimumAvailableCents: moneyCents(minimum),
      endingAvailableCents: finalRow.closingAvailableCents,
      retirementAvailableCents:
        retirementRow?.openingAvailableCents ?? finalRow.closingAvailableCents,
      endingDebtCents: finalRow.debtBalanceCents,
      endingNetWorthCents: finalRow.netWorthCents,
      requiredIncome: required,
      topInfluences,
    },
    traces: simulation.traces,
    resolution: resolved.traces,
    versions: {
      ...MONTHLY_CALCULATION_VERSIONS,
      data: plan.versions.data,
    },
  };
}

export function safeCalculateMonthlyLifePlan(
  plan: LifePlan
): SafeMonthlyCalculationResult {
  try {
    return { ok: true, result: calculateMonthlyLifePlan(plan) };
  } catch (error) {
    if (error instanceof LifeLedgerMonthlyCalculationError) {
      return {
        ok: false,
        error: {
          name: error.name,
          code: error.code,
          message: error.message,
          issues: error.issues,
        },
      };
    }
    return {
      ok: false,
      error: {
        name: 'LifeLedgerMonthlyCalculationError',
        code: 'ARITHMETIC_ERROR',
        message:
          error instanceof Error
            ? error.message
            : 'The calculation failed because an arithmetic value was invalid.',
        issues: [],
      },
    };
  }
}

export function describeCalculationMonth(month: MonthIndex) {
  return formatMonth(month);
}
