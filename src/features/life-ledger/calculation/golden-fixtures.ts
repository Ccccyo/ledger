import {
  basisPoints,
  createQuickLifePlan,
  moneyCents,
  monthIndex,
  yuan,
  type CashFlowItem,
  type LifePlan,
} from '../domain';

export interface GoldenCase {
  name: string;
  plan: LifePlan;
  expected: {
    endingAvailableCents: number;
    endingDebtCents: number;
    endingNetWorthCents: number;
    firstGapMonth: number | null;
  };
}

function simplePlan(id: string) {
  return createQuickLifePlan({
    id,
    baseYear: 2026,
    currentAge: 30,
    retirementAge: 31,
    endAge: 32,
    monthlyIncomeYuan: 1_000,
    monthlyWorkingExpensesYuan: 500,
    monthlyRetirementSelfFundedYuan: 500,
    currentSavingsYuan: 0,
    now: '2026-01-01T00:00:00.000Z',
  });
}

function standaloneMonthly(
  plan: LifePlan,
  id: string,
  name: string,
  direction: CashFlowItem['direction'],
  category: CashFlowItem['category'],
  amountYuan: number,
  startMonth = plan.baseMonth,
  endMonthExclusive = plan.endMonthExclusive,
  ownerId = plan.primaryMemberId
): CashFlowItem {
  return {
    id,
    name,
    direction,
    category,
    ownerId,
    amountCents: yuan(amountYuan),
    frequency: { kind: 'monthly' },
    startMonth,
    endMonthExclusive,
    annualGrowthBps: basisPoints(0),
    source: { kind: 'user', label: '人工黄金案例' },
    confirmation: 'confirmed',
  };
}

function withoutDefaultFlows(plan: LifePlan): LifePlan {
  return { ...plan, cashFlowBuckets: [], standaloneCashFlows: [] };
}

const singleRent = simplePlan('golden-single-rent');

const ownedHomeBase = withoutDefaultFlows(simplePlan('golden-owned-home'));
const ownedHome: LifePlan = {
  ...ownedHomeBase,
  assets: [
    ...ownedHomeBase.assets,
    {
      id: 'owned-home',
      name: '自住房',
      ownerId: ownedHomeBase.primaryMemberId,
      kind: 'property',
      openingBalanceCents: yuan(1_000_000),
      liquid: false,
      annualReturnBps: basisPoints(0),
      source: { kind: 'user', label: '人工黄金案例' },
      confirmation: 'confirmed',
    },
  ],
};

const mortgageBase = withoutDefaultFlows(simplePlan('golden-mortgage'));
const mortgage: LifePlan = {
  ...mortgageBase,
  standaloneCashFlows: [
    standaloneMonthly(
      mortgageBase,
      'mortgage-salary',
      '工资',
      'income',
      'salary',
      2_000,
      mortgageBase.baseMonth,
      mortgageBase.retirementMonth
    ),
  ],
  liabilities: [
    {
      id: 'mortgage',
      name: '房贷',
      ownerId: mortgageBase.primaryMemberId,
      kind: 'mortgage',
      openingPrincipalCents: yuan(12_000),
      annualInterestBps: basisPoints(0),
      monthlyPaymentCents: yuan(1_000),
      startMonth: mortgageBase.baseMonth,
      endMonthExclusive: mortgageBase.retirementMonth,
      source: { kind: 'user', label: '人工黄金案例' },
      confirmation: 'confirmed',
    },
  ],
};

const partnerBase = simplePlan('golden-partner');
const partner: LifePlan = {
  ...partnerBase,
  members: [
    ...partnerBase.members,
    {
      id: 'partner',
      name: '伴侣',
      role: 'partner',
      birthMonth: monthIndex(1996, 1),
    },
  ],
  standaloneCashFlows: [
    standaloneMonthly(
      partnerBase,
      'partner-income',
      '伴侣收入',
      'income',
      'salary',
      500,
      partnerBase.baseMonth,
      partnerBase.retirementMonth,
      'partner'
    ),
  ],
};

const childBase = simplePlan('golden-child');
const child: LifePlan = {
  ...childBase,
  members: [
    ...childBase.members,
    {
      id: 'child',
      name: '孩子',
      role: 'child',
      birthMonth: monthIndex(2020, 1),
    },
  ],
  standaloneCashFlows: [
    standaloneMonthly(
      childBase,
      'child-expense',
      '孩子支出',
      'expense',
      'child',
      100,
      childBase.baseMonth,
      childBase.endMonthExclusive,
      'child'
    ),
  ],
};

const parentBase = simplePlan('golden-parent');
const parentSupport: LifePlan = {
  ...parentBase,
  members: [
    ...parentBase.members,
    { id: 'parent', name: '父母', role: 'parent' },
  ],
  standaloneCashFlows: [
    standaloneMonthly(
      parentBase,
      'parent-expense',
      '父母赡养',
      'expense',
      'parent',
      100,
      parentBase.baseMonth,
      parentBase.endMonthExclusive,
      'parent'
    ),
  ],
};

const earlyBase = simplePlan('golden-early-retirement');
const earlyRetirementMonth = (earlyBase.baseMonth +
  6) as LifePlan['retirementMonth'];
const earlyRetirement: LifePlan = {
  ...earlyBase,
  retirementMonth: earlyRetirementMonth,
  cashFlowBuckets: earlyBase.cashFlowBuckets.map((bucket) => ({
    ...bucket,
    summary: bucket.summary
      ? {
          ...bucket.summary,
          startMonth:
            bucket.summary.category === 'retirement'
              ? earlyRetirementMonth
              : bucket.summary.startMonth,
          endMonthExclusive:
            bucket.summary.category === 'retirement'
              ? bucket.summary.endMonthExclusive
              : earlyRetirementMonth,
        }
      : undefined,
  })),
};

const interruptionBase = withoutDefaultFlows(
  simplePlan('golden-work-interruption')
);
const interruptionEnd = (interruptionBase.baseMonth +
  6) as LifePlan['retirementMonth'];
const workInterruption: LifePlan = {
  ...interruptionBase,
  standaloneCashFlows: [
    standaloneMonthly(
      interruptionBase,
      'short-salary',
      '工作中断前收入',
      'income',
      'salary',
      1_000,
      interruptionBase.baseMonth,
      interruptionEnd
    ),
    standaloneMonthly(
      interruptionBase,
      'living-expense',
      '生活支出',
      'expense',
      'living',
      500
    ),
  ],
};

const oneTimeBase = withoutDefaultFlows(simplePlan('golden-one-time'));
const oneTimeExpense: LifePlan = {
  ...oneTimeBase,
  assets: oneTimeBase.assets.map((asset) => ({
    ...asset,
    openingBalanceCents: yuan(10_000),
  })),
  standaloneCashFlows: [
    {
      ...standaloneMonthly(
        oneTimeBase,
        'large-expense',
        '一次性大额支出',
        'expense',
        'other',
        5_000
      ),
      frequency: { kind: 'once', postingMonth: oneTimeBase.baseMonth },
    },
  ],
};

const gapBase = withoutDefaultFlows(simplePlan('golden-intermediate-gap'));
const yearEnd = monthIndex(2026, 12);
const intermediateGap: LifePlan = {
  ...gapBase,
  standaloneCashFlows: [
    {
      ...standaloneMonthly(
        gapBase,
        'early-expense',
        '年初支出',
        'expense',
        'other',
        10_000
      ),
      frequency: { kind: 'once', postingMonth: gapBase.baseMonth },
    },
    {
      ...standaloneMonthly(
        gapBase,
        'late-income',
        '年末收入',
        'income',
        'other',
        12_000
      ),
      frequency: { kind: 'once', postingMonth: yearEnd },
    },
  ],
};

const housingBase = simplePlan('golden-housing-detail');
const housingDetail: LifePlan = {
  ...housingBase,
  cashFlowBuckets: housingBase.cashFlowBuckets.map((bucket) =>
    bucket.direction === 'expense' && bucket.summary?.category === 'living'
      ? {
          ...bucket,
          mode: 'detailed',
          details: [
            {
              ...bucket.summary,
              id: 'rent',
              name: '房租',
              category: 'housing',
              amountCents: yuan(300),
            },
            {
              ...bucket.summary,
              id: 'living',
              name: '家庭生活',
              amountCents: yuan(200),
            },
          ],
        }
      : bucket
  ),
};

export const GOLDEN_CASES: GoldenCase[] = [
  {
    name: '单身租房',
    plan: singleRent,
    expected: {
      endingAvailableCents: 0,
      endingDebtCents: 0,
      endingNetWorthCents: 0,
      firstGapMonth: null,
    },
  },
  {
    name: '已有住房',
    plan: ownedHome,
    expected: {
      endingAvailableCents: 0,
      endingDebtCents: 0,
      endingNetWorthCents: 100_000_000,
      firstGapMonth: null,
    },
  },
  {
    name: '房贷还款',
    plan: mortgage,
    expected: {
      endingAvailableCents: 1_200_000,
      endingDebtCents: 0,
      endingNetWorthCents: 1_200_000,
      firstGapMonth: null,
    },
  },
  {
    name: '伴侣收入',
    plan: partner,
    expected: {
      endingAvailableCents: 600_000,
      endingDebtCents: 0,
      endingNetWorthCents: 600_000,
      firstGapMonth: null,
    },
  },
  {
    name: '孩子支出',
    plan: child,
    expected: {
      endingAvailableCents: -240_000,
      endingDebtCents: 0,
      endingNetWorthCents: -240_000,
      firstGapMonth: child.baseMonth + 20,
    },
  },
  {
    name: '父母赡养',
    plan: parentSupport,
    expected: {
      endingAvailableCents: -240_000,
      endingDebtCents: 0,
      endingNetWorthCents: -240_000,
      firstGapMonth: parentBase.baseMonth + 20,
    },
  },
  {
    name: '提前退休',
    plan: earlyRetirement,
    expected: {
      endingAvailableCents: -600_000,
      endingDebtCents: 0,
      endingNetWorthCents: -600_000,
      firstGapMonth: earlyRetirement.baseMonth + 12,
    },
  },
  {
    name: '工作中断',
    plan: workInterruption,
    expected: {
      endingAvailableCents: -600_000,
      endingDebtCents: 0,
      endingNetWorthCents: -600_000,
      firstGapMonth: workInterruption.baseMonth + 12,
    },
  },
  {
    name: '一次性大额支出',
    plan: oneTimeExpense,
    expected: {
      endingAvailableCents: 500_000,
      endingDebtCents: 0,
      endingNetWorthCents: 500_000,
      firstGapMonth: null,
    },
  },
  {
    name: '最终有结余但中途缺钱',
    plan: intermediateGap,
    expected: {
      endingAvailableCents: 200_000,
      endingDebtCents: 0,
      endingNetWorthCents: 200_000,
      firstGapMonth: intermediateGap.baseMonth,
    },
  },
  {
    name: '住房与生活拆分替代总额',
    plan: housingDetail,
    expected: {
      endingAvailableCents: 0,
      endingDebtCents: 0,
      endingNetWorthCents: 0,
      firstGapMonth: null,
    },
  },
];

export const GOLDEN_ZERO = moneyCents(0);
