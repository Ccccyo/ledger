import type { LifePlanInput } from './types';

export const LIFE_PLAN_DEFAULTS: Readonly<LifePlanInput> = Object.freeze({
  mode: 'have',
  baseYear: 2026,
  currentAge: 28,
  retirementAge: 60,
  endAge: 90,
  monthlyIncome: 18_000,
  monthlyWorkingExpenses: 9_000,
  monthlyRetirementSelfFunded: 7_000,
  currentSavings: 200_000,
  assumptions: Object.freeze({
    realSavingsRate: 0,
    realBorrowingRate: 0,
    annualIncomeGrowthRate: 0,
    annualWorkingExpenseGrowthRate: 0,
    annualRetirementExpenseGrowthRate: 0,
  }),
});

export function createLifePlanInput(
  input: Partial<Omit<LifePlanInput, 'assumptions'>> & {
    assumptions?: Partial<LifePlanInput['assumptions']>;
  } = {}
): LifePlanInput {
  return {
    ...LIFE_PLAN_DEFAULTS,
    ...input,
    assumptions: {
      ...LIFE_PLAN_DEFAULTS.assumptions,
      ...input.assumptions,
    },
  };
}
