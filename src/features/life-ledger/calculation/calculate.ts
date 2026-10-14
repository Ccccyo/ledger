import type {
  AnnualCashFlow,
  CalculationErrorShape,
  CalculationResult,
  LifePlanInput,
  SafeCalculationResult,
} from './types';
import { validateLifePlanInput } from './validate';
import { CALCULATION_VERSIONS } from './versions';

export class LifeLedgerCalculationError
  extends Error
  implements CalculationErrorShape
{
  readonly name = 'LifeLedgerCalculationError' as const;

  constructor(
    readonly code: CalculationErrorShape['code'],
    message: string,
    readonly issues: CalculationErrorShape['issues'] = []
  ) {
    super(message);
  }
}

type Simulation = {
  annualCashFlow: AnnualCashFlow[];
  retirementBalance: number;
};

function grow(base: number, rate: number, years: number) {
  return base * Math.pow(1 + rate, years);
}

function retirementTargetAtStart(
  annualCashFlow: AnnualCashFlow[],
  realSavingsRate: number
) {
  return annualCashFlow
    .filter((year) => year.phase === 'retired')
    .reduceRight(
      (requiredAtYearEnd, year) =>
        (requiredAtYearEnd + year.expenses) / (1 + realSavingsRate),
      0
    );
}

function simulate(input: LifePlanInput, monthlyIncome: number): Simulation {
  const annualCashFlow: AnnualCashFlow[] = [];
  let balance = input.currentSavings;
  let retirementBalance = input.currentSavings;

  for (let age = input.currentAge; age < input.endAge; age += 1) {
    const year = input.baseYear + age - input.currentAge;
    const working = age < input.retirementAge;
    const yearsFromStart = age - input.currentAge;
    const yearsFromRetirement = Math.max(0, age - input.retirementAge);
    const openingBalance = balance;
    const rate =
      openingBalance >= 0
        ? input.assumptions.realSavingsRate
        : input.assumptions.realBorrowingRate;
    const interest = openingBalance * rate;
    const income = working
      ? grow(
          monthlyIncome * 12,
          input.assumptions.annualIncomeGrowthRate,
          yearsFromStart
        )
      : 0;
    const expenses = working
      ? grow(
          input.monthlyWorkingExpenses * 12,
          input.assumptions.annualWorkingExpenseGrowthRate,
          yearsFromStart
        )
      : grow(
          input.monthlyRetirementSelfFunded * 12,
          input.assumptions.annualRetirementExpenseGrowthRate,
          yearsFromRetirement
        );
    const netCashFlow = income - expenses;
    balance = openingBalance + interest + netCashFlow;

    if (age === input.retirementAge) {
      retirementBalance = openingBalance;
    }

    annualCashFlow.push({
      year,
      age,
      phase: working ? 'working' : 'retired',
      openingBalance,
      income,
      expenses,
      interest,
      netCashFlow,
      closingBalance: balance,
    });
  }

  return { annualCashFlow, retirementBalance };
}

function solveRequiredMonthlyIncome(input: LifePlanInput): number {
  const endingBalance = (income: number) =>
    simulate(input, income).annualCashFlow.at(-1)?.closingBalance ??
    input.currentSavings;

  if (endingBalance(0) >= 0) return 0;

  let low = 0;
  let high = Math.max(
    input.monthlyIncome,
    input.monthlyWorkingExpenses + input.monthlyRetirementSelfFunded,
    1
  );

  while (endingBalance(high) < 0 && high < 1_000_000_000) {
    high *= 2;
  }

  if (endingBalance(high) < 0) {
    throw new LifeLedgerCalculationError(
      'NON_CONVERGENT_RESULT',
      'Unable to find a finite required monthly income.'
    );
  }

  for (let iteration = 0; iteration < 80; iteration += 1) {
    const midpoint = (low + high) / 2;
    if (endingBalance(midpoint) >= 0) high = midpoint;
    else low = midpoint;
  }

  return high;
}

export function calculateLifePlan(input: LifePlanInput): CalculationResult {
  const validation = validateLifePlanInput(input);
  if (!validation.valid) {
    throw new LifeLedgerCalculationError(
      'INVALID_INPUT',
      'The life plan contains invalid input.',
      validation.issues
    );
  }

  const requiredMonthlyIncome = solveRequiredMonthlyIncome(input);
  const incomeUsed =
    input.mode === 'need' ? requiredMonthlyIncome : input.monthlyIncome;
  const simulation = simulate(input, incomeUsed);
  const annualCashFlow = simulation.annualCashFlow;
  const endingBalance =
    annualCashFlow.at(-1)?.closingBalance ?? input.currentSavings;
  const firstDeficit = annualCashFlow.find((year) => year.closingBalance < 0);
  const minimum = annualCashFlow.reduce(
    (current, year) =>
      year.closingBalance < current.balance
        ? { balance: year.closingBalance, age: year.age, year: year.year }
        : current,
    {
      balance: input.currentSavings,
      age: input.currentAge,
      year: input.baseYear,
    }
  );
  const retirementYears = input.endAge - input.retirementAge;
  const targetRetirementFund = retirementTargetAtStart(
    annualCashFlow,
    input.assumptions.realSavingsRate
  );
  const projectedRetirementBalance = simulation.retirementBalance;
  const retirementSurplusOrGap =
    projectedRetirementBalance - targetRetirementFund;

  return {
    input: Object.freeze({
      ...input,
      assumptions: Object.freeze({ ...input.assumptions }),
    }),
    annualCashFlow,
    summary: {
      workingYears: input.retirementAge - input.currentAge,
      retirementYears,
      workingMonths: (input.retirementAge - input.currentAge) * 12,
      retirementMonths: retirementYears * 12,
      monthlySurplus: incomeUsed - input.monthlyWorkingExpenses,
      requiredMonthlyIncome,
      additionalMonthlyIncomeNeeded: Math.max(
        0,
        requiredMonthlyIncome - input.monthlyIncome
      ),
      targetRetirementFund,
      projectedRetirementBalance,
      retirementFundingRatio:
        targetRetirementFund > 0
          ? projectedRetirementBalance / targetRetirementFund
          : 1,
      retirementSurplusOrGap,
      endingBalance,
      hasAnyDeficit: Boolean(firstDeficit),
      firstDeficitAge: firstDeficit?.age ?? null,
      firstDeficitYear: firstDeficit?.year ?? null,
      minimumBalance: minimum.balance,
      minimumBalanceAge: minimum.age,
      minimumBalanceYear: minimum.year,
    },
    versions: { ...CALCULATION_VERSIONS },
  };
}

export function safeCalculateLifePlan(
  input: LifePlanInput
): SafeCalculationResult {
  try {
    return { ok: true, result: calculateLifePlan(input) };
  } catch (error) {
    if (error instanceof LifeLedgerCalculationError) {
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
    throw error;
  }
}
