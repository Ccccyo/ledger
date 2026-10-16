import {
  basisPoints,
  validateLifePlan,
  yuan,
  type CashFlowItem,
  type LifePlan,
  type MonthIndex,
} from '../../domain';

export type CareerKind = 'salary' | 'side_income' | 'break';

export function salaryGrowthBps(plan: LifePlan): number {
  return (
    plan.cashFlowBuckets
      .flatMap((b) =>
        b.mode === 'summary' ? (b.summary ? [b.summary] : []) : b.details
      )
      .find(
        (f) =>
          f.ownerId === plan.primaryMemberId &&
          f.category === 'salary' &&
          f.direction === 'income'
      )?.annualGrowthBps ?? 0
  );
}

export function salaryGrowthPeriod(plan: LifePlan) {
  const flow = plan.cashFlowBuckets
    .flatMap((b) =>
      b.mode === 'summary' ? (b.summary ? [b.summary] : []) : b.details
    )
    .find(
      (item) =>
        item.ownerId === plan.primaryMemberId &&
        item.category === 'salary' &&
        item.direction === 'income'
    );
  return {
    start: flow?.growthStartMonth ?? flow?.startMonth ?? plan.baseMonth,
    end:
      flow?.growthEndMonthExclusive ??
      flow?.endMonthExclusive ??
      plan.retirementMonth,
  };
}

export function updateSalaryGrowth(
  plan: LifePlan,
  percent: number,
  start: MonthIndex = salaryGrowthPeriod(plan).start,
  end: MonthIndex = salaryGrowthPeriod(plan).end
): LifePlan {
  if (
    !Number.isFinite(percent) ||
    percent < -99 ||
    percent > 100 ||
    start < plan.baseMonth ||
    end > plan.retirementMonth ||
    start >= end
  )
    throw new Error('Invalid growth rate');
  const annualGrowthBps = basisPoints(Math.round(percent * 100));
  const update = (f: CashFlowItem) =>
    f.ownerId === plan.primaryMemberId &&
    f.category === 'salary' &&
    f.direction === 'income'
      ? {
          ...f,
          annualGrowthBps,
          growthStartMonth: start,
          growthEndMonthExclusive: end,
        }
      : f;
  return {
    ...plan,
    cashFlowBuckets: plan.cashFlowBuckets.map((b) => ({
      ...b,
      summary: b.summary ? update(b.summary) : undefined,
      details: b.details.map(update),
    })),
    metadata: {
      ...plan.metadata,
      excludedLifeStages: plan.metadata.excludedLifeStages?.filter(
        (s) => s !== 'career'
      ),
    },
  };
}
export function saveCareerChange(
  plan: LifePlan,
  input: {
    id: string;
    kind: CareerKind;
    amount: number;
    start: MonthIndex;
    end: MonthIndex;
    name: string;
    annualGrowthPercent?: number;
  }
): LifePlan {
  if (
    !['salary', 'side_income', 'break'].includes(input.kind) ||
    !input.name.trim() ||
    !Number.isFinite(input.amount) ||
    input.amount < 0 ||
    input.amount > 1e9 ||
    (input.kind !== 'break' && input.amount === 0) ||
    !Number.isSafeInteger(input.start) ||
    !Number.isSafeInteger(input.end) ||
    input.start < plan.baseMonth ||
    input.start >= input.end ||
    input.end >
      (input.kind === 'side_income'
        ? plan.endMonthExclusive
        : plan.retirementMonth)
  )
    throw new Error('Invalid career change');
  // An unclassified income remainder might contain salary or side income. Never guess.
  if (
    input.kind !== 'side_income' &&
    plan.cashFlowBuckets.some(
      (b) =>
        b.direction === 'income' &&
        b.mode === 'detailed' &&
        b.summary &&
        b.details.reduce((s, f) => s + f.amountCents, 0) < b.summary.amountCents
    )
  ) {
    throw new Error('Classify income before replacing salary');
  }
  const existing = plan.standaloneCashFlows.find((f) => f.id === input.id);
  const flow: CashFlowItem = {
    id: input.id,
    name: input.name.trim(),
    ownerId: plan.primaryMemberId,
    direction: 'income',
    category: input.kind === 'side_income' ? 'side_income' : 'salary',
    amountCents: yuan(input.kind === 'break' ? 0 : input.amount),
    frequency: { kind: 'monthly' },
    startMonth: input.start,
    endMonthExclusive: input.end,
    annualGrowthBps:
      input.annualGrowthPercent === undefined
        ? (existing?.annualGrowthBps ??
          basisPoints(input.kind === 'salary' ? salaryGrowthBps(plan) : 0))
        : basisPoints(Math.round(input.annualGrowthPercent * 100)),
    source: { kind: 'user', label: '用户填写' },
    confirmation: 'confirmed',
    ...(input.kind !== 'side_income'
      ? { incomeTreatment: 'replace-salary' as const }
      : {}),
  };
  const next: LifePlan = {
    ...plan,
    standaloneCashFlows: [
      ...plan.standaloneCashFlows.filter((f) => f.id !== input.id),
      flow,
    ],
    metadata: {
      ...plan.metadata,
      excludedLifeStages: plan.metadata.excludedLifeStages?.filter(
        (s) => s !== 'career'
      ),
    },
  };
  if (!validateLifePlan(next).valid)
    throw new Error('Invalid or overlapping career change');
  return next;
}
