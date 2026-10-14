export type CalculationMode = 'have' | 'need';

export type CashFlowPhase = 'working' | 'retired';

export type CalculationIssueCode =
  | 'NOT_FINITE'
  | 'OUT_OF_RANGE'
  | 'INVALID_AGE_ORDER'
  | 'NEGATIVE_AMOUNT'
  | 'INVALID_RATE';

export type CalculationField =
  | 'mode'
  | 'baseYear'
  | 'currentAge'
  | 'retirementAge'
  | 'endAge'
  | 'monthlyIncome'
  | 'monthlyWorkingExpenses'
  | 'monthlyRetirementSelfFunded'
  | 'currentSavings'
  | 'assumptions.realSavingsRate'
  | 'assumptions.realBorrowingRate'
  | 'assumptions.annualIncomeGrowthRate'
  | 'assumptions.annualWorkingExpenseGrowthRate'
  | 'assumptions.annualRetirementExpenseGrowthRate';

export interface CalculationAssumptions {
  /** Real annual return after inflation, expressed as a decimal. */
  realSavingsRate: number;
  /** Real annual borrowing cost after inflation, expressed as a decimal. */
  realBorrowingRate: number;
  /** Annual take-home income growth in today's money. */
  annualIncomeGrowthRate: number;
  /** Annual working-life expense growth in today's money. */
  annualWorkingExpenseGrowthRate: number;
  /** Annual retirement expense growth in today's money. */
  annualRetirementExpenseGrowthRate: number;
}

export interface LifePlanInput {
  mode: CalculationMode;
  /** Calendar year represented by currentAge. It is input, never read from Date. */
  baseYear: number;
  currentAge: number;
  retirementAge: number;
  /** Exclusive upper bound: an endAge of 90 models cash flow through age 89. */
  endAge: number;
  monthlyIncome: number;
  monthlyWorkingExpenses: number;
  /** Amount still paid from personal savings after pension and stable income. */
  monthlyRetirementSelfFunded: number;
  currentSavings: number;
  assumptions: CalculationAssumptions;
}

export interface CalculationIssue {
  code: CalculationIssueCode;
  field: CalculationField;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: CalculationIssue[];
}

export interface AnnualCashFlow {
  year: number;
  age: number;
  phase: CashFlowPhase;
  openingBalance: number;
  income: number;
  expenses: number;
  interest: number;
  netCashFlow: number;
  closingBalance: number;
}

export interface CalculationVersions {
  calculation: string;
  inputSchema: string;
  cityData: string;
  educationData: string;
}

export interface CalculationSummary {
  workingYears: number;
  retirementYears: number;
  workingMonths: number;
  retirementMonths: number;
  monthlySurplus: number;
  requiredMonthlyIncome: number;
  additionalMonthlyIncomeNeeded: number;
  targetRetirementFund: number;
  projectedRetirementBalance: number;
  retirementFundingRatio: number;
  retirementSurplusOrGap: number;
  endingBalance: number;
  hasAnyDeficit: boolean;
  firstDeficitAge: number | null;
  firstDeficitYear: number | null;
  minimumBalance: number;
  minimumBalanceAge: number;
  minimumBalanceYear: number;
}

export interface CalculationResult {
  input: Readonly<LifePlanInput>;
  annualCashFlow: AnnualCashFlow[];
  summary: CalculationSummary;
  versions: CalculationVersions;
}

export interface CalculationFailure {
  ok: false;
  error: CalculationErrorShape;
}

export interface CalculationSuccess {
  ok: true;
  result: CalculationResult;
}

export type SafeCalculationResult = CalculationSuccess | CalculationFailure;

export interface CalculationErrorShape {
  name: 'LifeLedgerCalculationError';
  code: 'INVALID_INPUT' | 'NON_CONVERGENT_RESULT';
  message: string;
  issues: CalculationIssue[];
}
