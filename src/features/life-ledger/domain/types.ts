export type CurrencyCode = 'CNY';

/** Integer minor units. CNY 1.00 is stored as 100 cents. */
export type MoneyCents = number & { readonly __brand: 'MoneyCents' };
/** Integer month index: year * 12 + (month - 1). */
export type MonthIndex = number & { readonly __brand: 'MonthIndex' };
/** Integer annual rate in basis points. 100 bps = 1%. */
export type BasisPoints = number & { readonly __brand: 'BasisPoints' };

export type DataSourceKind = 'user' | 'system' | 'external' | 'agent';

export interface ValueSource {
  kind: DataSourceKind;
  label: string;
  referenceUrl?: string;
  region?: string;
  effectiveMonth?: MonthIndex;
  retrievedAt?: string;
}

export type ConfirmationState = 'confirmed' | 'pending';
export type MemberRole = 'self' | 'partner' | 'child' | 'parent' | 'other';

export interface PlanMember {
  id: string;
  name: string;
  role: MemberRole;
  birthMonth?: MonthIndex;
}

export type CashFlowDirection = 'income' | 'expense';
export type CashFlowCategory =
  | 'salary'
  | 'side_income'
  | 'pension'
  | 'housing'
  | 'living'
  | 'child'
  | 'parent'
  | 'retirement'
  | 'healthcare'
  | 'tax'
  | 'other';

export type CashFlowFrequency =
  | { kind: 'monthly' }
  | { kind: 'yearly'; postingMonth: number }
  | { kind: 'once'; postingMonth: MonthIndex };

export interface CashFlowItem {
  id: string;
  name: string;
  direction: CashFlowDirection;
  category: CashFlowCategory;
  ownerId: string;
  /** Amount per frequency occurrence, stored in cents. */
  amountCents: MoneyCents;
  frequency: CashFlowFrequency;
  startMonth: MonthIndex;
  endMonthExclusive: MonthIndex;
  /** Real annual growth rate in basis points. */
  annualGrowthBps: BasisPoints;
  source: ValueSource;
  confirmation: ConfirmationState;
  /** Explicitly replaces the primary member's salary during this interval. */
  incomeTreatment?: 'replace-salary';
}

export type BucketMode = 'summary' | 'detailed';

/**
 * A bucket is the only place where a summary amount and detailed amounts can
 * coexist in stored data. Resolution guarantees that only one representation
 * enters the calculator.
 */
export interface CashFlowBucket {
  id: string;
  name: string;
  direction: CashFlowDirection;
  mode: BucketMode;
  summary?: CashFlowItem;
  details: CashFlowItem[];
  /** Required when details exceed the previous summary. */
  confirmedDetailedTotalCents?: MoneyCents;
}

export type AssetKind =
  | 'cash'
  | 'deposit'
  | 'investment'
  | 'property'
  | 'other';

export interface Asset {
  id: string;
  name: string;
  ownerId: string;
  kind: AssetKind;
  openingBalanceCents: MoneyCents;
  /** Only liquid assets are included in available cash. */
  liquid: boolean;
  annualReturnBps: BasisPoints;
  source: ValueSource;
  confirmation: ConfirmationState;
}

export type LiabilityKind = 'mortgage' | 'consumer' | 'other';

export interface Liability {
  id: string;
  name: string;
  ownerId: string;
  kind: LiabilityKind;
  openingPrincipalCents: MoneyCents;
  annualInterestBps: BasisPoints;
  monthlyPaymentCents: MoneyCents;
  startMonth: MonthIndex;
  endMonthExclusive: MonthIndex;
  source: ValueSource;
  confirmation: ConfirmationState;
}

export interface PlanAssumptions {
  purchasingPower: 'today';
  annualLiquidReturnBps: BasisPoints;
  annualCashGapCostBps: BasisPoints;
}

export interface PlanVersions {
  schema: string;
  calculation: string;
  data: string;
}

export interface LifePlan {
  schemaVersion: '2.0.0';
  id: string;
  name: string;
  currency: CurrencyCode;
  baseMonth: MonthIndex;
  endMonthExclusive: MonthIndex;
  retirementMonth: MonthIndex;
  primaryMemberId: string;
  members: PlanMember[];
  cashFlowBuckets: CashFlowBucket[];
  /** One-time and independent flows that do not replace a summary total. */
  standaloneCashFlows: CashFlowItem[];
  assets: Asset[];
  liabilities: Liability[];
  assumptions: PlanAssumptions;
  versions: PlanVersions;
  metadata: {
    createdAt: string;
    updatedAt: string;
    /** Explicit user decisions; absent on older plans. Does not alter cash flows. */
    excludedLifeStages?: (
      | 'career'
      | 'partner'
      | 'child'
      | 'housing'
      | 'parents'
    )[];
  };
}

export interface ResolvedCashFlow extends CashFlowItem {
  resolution: 'summary' | 'detail' | 'unallocated' | 'standalone';
  bucketId?: string;
}

export interface ResolutionTrace {
  bucketId: string;
  mode: BucketMode;
  excludedSummaryId?: string;
  includedFlowIds: string[];
  generatedUnallocatedFlowId?: string;
  summaryMonthlyCents: MoneyCents;
  detailedMonthlyCents: MoneyCents;
}

export interface ResolvedPlan {
  plan: Readonly<LifePlan>;
  cashFlows: ResolvedCashFlow[];
  traces: ResolutionTrace[];
}
