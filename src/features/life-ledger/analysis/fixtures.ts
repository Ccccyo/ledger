import {
  addMonths,
  basisPoints,
  createQuickLifePlan,
  yuan,
  type CashFlowItem,
  type LifePlan,
} from '../domain';

const FIXTURE_NOW = '2026-10-14T00:00:00.000Z';

export function createPersonalBaselineFixture(): LifePlan {
  return createQuickLifePlan({
    id: 'fixture-personal-baseline',
    name: '个人基线',
    baseYear: 2026,
    currentAge: 30,
    retirementAge: 60,
    endAge: 90,
    monthlyIncomeYuan: 18_000,
    monthlyWorkingExpensesYuan: 9_000,
    monthlyRetirementSelfFundedYuan: 9_000,
    currentSavingsYuan: 0,
    now: FIXTURE_NOW,
  });
}

export function createHousingChildOverlapFixture(): LifePlan {
  const base = createQuickLifePlan({
    id: 'fixture-housing-child-overlap',
    name: '购房与孩子支出重叠',
    baseYear: 2026,
    currentAge: 30,
    retirementAge: 60,
    endAge: 70,
    monthlyIncomeYuan: 30_000,
    monthlyWorkingExpensesYuan: 10_000,
    monthlyRetirementSelfFundedYuan: 10_000,
    currentSavingsYuan: 500_000,
    now: FIXTURE_NOW,
  });
  const housingMonth = addMonths(base.baseMonth, 24);
  const childMonth = addMonths(housingMonth, 6);
  const selfId = base.primaryMemberId;
  const housing: CashFlowItem = {
    id: `${base.id}:housing-down-payment`,
    name: '购房首付',
    direction: 'expense',
    category: 'housing',
    ownerId: selfId,
    amountCents: yuan(800_000),
    frequency: { kind: 'once', postingMonth: housingMonth },
    startMonth: housingMonth,
    endMonthExclusive: addMonths(housingMonth, 1),
    annualGrowthBps: basisPoints(0),
    source: { kind: 'user', label: '用户填写' },
    confirmation: 'confirmed',
  };
  const child: CashFlowItem = {
    id: `${base.id}:child-monthly`,
    name: '孩子每月支出',
    direction: 'expense',
    category: 'child',
    ownerId: selfId,
    amountCents: yuan(5_000),
    frequency: { kind: 'monthly' },
    startMonth: childMonth,
    endMonthExclusive: addMonths(childMonth, 18 * 12),
    annualGrowthBps: basisPoints(0),
    source: { kind: 'user', label: '用户填写' },
    confirmation: 'confirmed',
  };

  return {
    ...base,
    standaloneCashFlows: [housing, child],
  };
}

export function createLiquidityGapFixture(): LifePlan {
  const base = createQuickLifePlan({
    id: 'fixture-liquidity-gap',
    name: '现金为负但净资产为正',
    baseYear: 2026,
    currentAge: 30,
    retirementAge: 31,
    endAge: 32,
    monthlyIncomeYuan: 5_000,
    monthlyWorkingExpensesYuan: 10_000,
    monthlyRetirementSelfFundedYuan: 10_000,
    currentSavingsYuan: 10_000,
    now: FIXTURE_NOW,
  });

  return {
    ...base,
    assets: [
      ...base.assets,
      {
        id: `${base.id}:property`,
        name: '自住房',
        ownerId: base.primaryMemberId,
        kind: 'property',
        openingBalanceCents: yuan(1_000_000),
        liquid: false,
        annualReturnBps: basisPoints(0),
        source: { kind: 'user', label: '用户填写' },
        confirmation: 'confirmed',
      },
    ],
  };
}

export const analysisFixtures = [
  {
    id: 'personal-baseline',
    plan: createPersonalBaselineFixture(),
  },
  {
    id: 'housing-child-overlap',
    plan: createHousingChildOverlapFixture(),
  },
  {
    id: 'liquidity-gap',
    plan: createLiquidityGapFixture(),
  },
] as const;
