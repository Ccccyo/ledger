import { basisPoints, moneyCents, monthIndex, yuan } from './primitives';
import type { CashFlowItem, LifePlan, ValueSource } from './types';

export const USER_SOURCE: ValueSource = Object.freeze({
  kind: 'user',
  label: '用户填写',
});

export interface QuickPlanValues {
  id?: string;
  name?: string;
  baseYear?: number;
  baseMonth?: LifePlan['baseMonth'];
  currentAge?: number;
  retirementAge?: number;
  endAge?: number;
  monthlyIncomeYuan?: number;
  monthlyWorkingExpensesYuan?: number;
  monthlyRetirementSelfFundedYuan?: number;
  currentSavingsYuan?: number;
  now?: string;
}

function monthlyFlow(
  values: Omit<
    CashFlowItem,
    'frequency' | 'annualGrowthBps' | 'source' | 'confirmation'
  >
): CashFlowItem {
  return {
    ...values,
    frequency: { kind: 'monthly' },
    annualGrowthBps: basisPoints(0),
    source: USER_SOURCE,
    confirmation: 'confirmed',
  };
}

/**
 * Converts the Landing Page's intentionally small input into the full P0 model.
 * Generated IDs are deterministic so the same handoff can be retried safely.
 */
export function createQuickLifePlan(values: QuickPlanValues = {}): LifePlan {
  const id = values.id ?? 'local-plan';
  const now = values.now ?? '2026-01-01T00:00:00.000Z';
  const baseYear = values.baseYear ?? 2026;
  const currentAge = values.currentAge ?? 28;
  const retirementAge = values.retirementAge ?? 60;
  const endAge = values.endAge ?? 90;
  const baseMonth = values.baseMonth ?? monthIndex(baseYear, 1);
  const retirementMonth = (baseMonth +
    (retirementAge - currentAge) * 12) as LifePlan['retirementMonth'];
  const endMonthExclusive = (baseMonth +
    (endAge - currentAge) * 12) as LifePlan['endMonthExclusive'];
  const selfId = `${id}:self`;

  const income = monthlyFlow({
    id: `${id}:income-summary`,
    name: '家庭每月到手收入',
    direction: 'income',
    category: 'salary',
    ownerId: selfId,
    amountCents: yuan(values.monthlyIncomeYuan ?? 18_000),
    startMonth: baseMonth,
    endMonthExclusive: retirementMonth,
  });
  const workingExpenses = monthlyFlow({
    id: `${id}:working-expense-summary`,
    name: '工作期每月开销',
    direction: 'expense',
    category: 'living',
    ownerId: selfId,
    amountCents: yuan(values.monthlyWorkingExpensesYuan ?? 9_000),
    startMonth: baseMonth,
    endMonthExclusive: retirementMonth,
  });
  const retirementExpenses = monthlyFlow({
    id: `${id}:retirement-expense-summary`,
    name: '退休后每月需自付',
    direction: 'expense',
    category: 'retirement',
    ownerId: selfId,
    amountCents: yuan(values.monthlyRetirementSelfFundedYuan ?? 7_000),
    startMonth: retirementMonth,
    endMonthExclusive,
  });

  return {
    schemaVersion: '2.0.0',
    id,
    name: values.name ?? '我的一生账本',
    currency: 'CNY',
    baseMonth,
    endMonthExclusive,
    retirementMonth,
    primaryMemberId: selfId,
    members: [
      {
        id: selfId,
        name: '我',
        role: 'self',
        birthMonth: monthIndex(baseYear - currentAge, 1),
      },
    ],
    cashFlowBuckets: [
      {
        id: `${id}:income`,
        name: '家庭收入',
        direction: 'income',
        mode: 'summary',
        summary: income,
        details: [],
      },
      {
        id: `${id}:working-expenses`,
        name: '工作期开销',
        direction: 'expense',
        mode: 'summary',
        summary: workingExpenses,
        details: [],
      },
      {
        id: `${id}:retirement-expenses`,
        name: '退休期开销',
        direction: 'expense',
        mode: 'summary',
        summary: retirementExpenses,
        details: [],
      },
    ],
    standaloneCashFlows: [],
    assets: [
      {
        id: `${id}:cash`,
        name: '现有可用存款',
        ownerId: selfId,
        kind: 'cash',
        openingBalanceCents: yuan(values.currentSavingsYuan ?? 200_000),
        liquid: true,
        annualReturnBps: basisPoints(0),
        source: USER_SOURCE,
        confirmation: 'confirmed',
      },
    ],
    liabilities: [],
    assumptions: {
      purchasingPower: 'today',
      annualLiquidReturnBps: basisPoints(0),
      annualCashGapCostBps: basisPoints(0),
    },
    versions: {
      schema: '2.0.0',
      calculation: '2.0.0',
      data: '2026.10.0',
    },
    metadata: { createdAt: now, updatedAt: now },
  };
}

export const ZERO_CENTS = moneyCents(0);
