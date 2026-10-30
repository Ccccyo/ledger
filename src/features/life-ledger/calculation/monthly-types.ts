import type {
  CashFlowCategory,
  LifePlan,
  MoneyCents,
  MonthIndex,
  PlanIssue,
  ResolutionTrace,
} from '../domain';

export interface CalculationTraceEntry {
  id: string;
  month: MonthIndex;
  kind:
    | 'cash-flow'
    | 'liquid-return'
    | 'investment-allocation'
    | 'investment-release'
    | 'asset-return'
    | 'debt-interest'
    | 'debt-payment'
    | 'income-supplement';
  inputId?: string;
  sourceKind?: string;
  rule: string;
  amountCents: MoneyCents;
}

export type CategoryTotals = Partial<Record<CashFlowCategory, MoneyCents>>;

export interface MonthlyLedgerRow {
  month: MonthIndex;
  year: number;
  age: number | null;
  phase: 'working' | 'retired';
  openingAvailableCents: MoneyCents;
  openingReservedInvestmentCents: MoneyCents;
  incomeCents: MoneyCents;
  expenseCents: MoneyCents;
  liquidReturnCents: MoneyCents;
  investmentAllocatedCents: MoneyCents;
  investmentReleasedCents: MoneyCents;
  netCashFlowCents: MoneyCents;
  closingAvailableCents: MoneyCents;
  reservedInvestmentCents: MoneyCents;
  nonLiquidAssetsCents: MoneyCents;
  debtBalanceCents: MoneyCents;
  netWorthCents: MoneyCents;
  incomeByCategory: CategoryTotals;
  expenseByCategory: CategoryTotals;
  traceIds: string[];
}

export interface AnnualLedgerRow {
  year: number;
  ageStart: number | null;
  ageEnd: number | null;
  phase: 'working' | 'retired' | 'transition';
  openingAvailableCents: MoneyCents;
  openingReservedInvestmentCents: MoneyCents;
  incomeCents: MoneyCents;
  expenseCents: MoneyCents;
  liquidReturnCents: MoneyCents;
  investmentAllocatedCents: MoneyCents;
  investmentReleasedCents: MoneyCents;
  netCashFlowCents: MoneyCents;
  closingAvailableCents: MoneyCents;
  closingReservedInvestmentCents: MoneyCents;
  minimumAvailableCents: MoneyCents;
  closingNonLiquidAssetsCents: MoneyCents;
  closingDebtBalanceCents: MoneyCents;
  closingNetWorthCents: MoneyCents;
  incomeByCategory: CategoryTotals;
  expenseByCategory: CategoryTotals;
}

export interface RequiredIncomeResult {
  endpointZeroMonthlyIncomeCents: MoneyCents;
  endpointZeroSupplementCents: MoneyCents;
  noGapMonthlyIncomeCents: MoneyCents;
  noGapSupplementCents: MoneyCents;
}

export interface InfluenceResult {
  inputId: string;
  label: string;
  perturbation: string;
  endingAvailableDeltaCents: MoneyCents;
  absoluteImpactCents: MoneyCents;
}

export interface MonthlyCalculationSummary {
  hasAnyGap: boolean;
  firstGapMonth: MonthIndex | null;
  firstGapYear: number | null;
  minimumAvailableCents: MoneyCents;
  endingAvailableCents: MoneyCents;
  retirementAvailableCents: MoneyCents;
  endingDebtCents: MoneyCents;
  endingNetWorthCents: MoneyCents;
  requiredIncome: RequiredIncomeResult;
  topInfluences: InfluenceResult[];
}

export interface MonthlyCalculationVersions {
  calculation: '2.3.0';
  schema: '2.0.0';
  data: string;
  rules: 'monthly-cashflow-housing-2026-10';
}

export interface MonthlyCalculationResult {
  input: Readonly<LifePlan>;
  inputHash: string;
  inputSummary: {
    planId: string;
    baseMonth: MonthIndex;
    endMonthExclusive: MonthIndex;
    flowCount: number;
    assetCount: number;
    liabilityCount: number;
  };
  monthly: MonthlyLedgerRow[];
  annual: AnnualLedgerRow[];
  summary: MonthlyCalculationSummary;
  traces: CalculationTraceEntry[];
  resolution: ResolutionTrace[];
  versions: MonthlyCalculationVersions;
}

export interface MonthlyCalculationErrorShape {
  name: 'LifeLedgerMonthlyCalculationError';
  code: 'INVALID_PLAN' | 'NON_CONVERGENT_RESULT' | 'ARITHMETIC_ERROR';
  message: string;
  issues: PlanIssue[];
}

export type SafeMonthlyCalculationResult =
  | { ok: true; result: MonthlyCalculationResult }
  | { ok: false; error: MonthlyCalculationErrorShape };
