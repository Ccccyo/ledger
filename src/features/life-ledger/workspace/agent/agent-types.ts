import type { PlanPatch } from '../../analysis/action-patches';

export interface AgentAnnualRow {
  year: number;
  ageStart: number | null;
  ageEnd: number | null;
  phase: 'working' | 'retired' | 'transition';
  incomeCents: number;
  expenseCents: number;
  netCashFlowCents: number;
  closingAvailableCents: number;
  minimumAvailableCents: number;
  closingNetWorthCents: number;
  expenseByCategory: Record<string, number>;
  topExpenseCategories: string[];
}

export interface AgentEditableTarget {
  id: string;
  kind: 'cash-flow' | 'liquid-asset' | 'retirement';
  label: string;
  category?: string;
  amountCents?: number;
  startMonth?: number;
  endMonthExclusive?: number;
}

export interface LifeLedgerAgentContext {
  planHash: string;
  planName: string;
  baseMonth: number;
  endMonthExclusive: number;
  retirementMonth: number;
  primaryBirthMonth: number | null;
  currentAge: number | null;
  retirementAge: number | null;
  endAge: number | null;
  summary: {
    firstGapMonth: number | null;
    firstGapYear: number | null;
    minimumAvailableCents: number;
    endingAvailableCents: number;
    endingNetWorthCents: number;
    retirementAvailableCents: number;
  };
  keyEvents: Array<{
    id: string;
    label: string;
    category: string;
    direction: 'income' | 'expense';
    amountCents: number;
    startMonth: number;
    endMonthExclusive: number;
    frequency: 'monthly' | 'yearly' | 'once';
    annualGrowthBps: number;
    sourceLabel: string;
    incomeTreatment: 'replace-salary' | null;
  }>;
  assets: Array<{
    id: string;
    name: string;
    kind: string;
    liquid: boolean;
    openingBalanceCents: number;
    annualReturnBps: number;
    acquiredMonth: number | null;
    purchaseLiabilityId: string | null;
    downPaymentFlowId: string | null;
  }>;
  liabilities: Array<{
    id: string;
    name: string;
    kind: string;
    openingPrincipalCents: number;
    annualInterestBps: number;
    monthlyPaymentCents: number;
    startMonth: number;
    endMonthExclusive: number;
  }>;
  investments: Array<{
    id: string;
    name: string;
    principalCents: number;
    riskLevel: string;
    lowerAnnualReturnBps: number;
    upperAnnualReturnBps: number;
    startMonth: number;
    endMonthExclusive: number;
  }>;
  relocations: Array<{
    id: string;
    currentCity: string | null;
    targetCity: string;
    moveMonth: number;
    movingExpenseFlowId: string | null;
    housingAdjustmentFlowId: string | null;
    livingAdjustmentFlowId: string | null;
    incomeAdjustmentFlowId: string | null;
    flowIds: string[];
  }>;
  topInfluences: Array<{
    inputId: string;
    label: string;
    perturbation: string;
    endingAvailableDeltaCents: number;
    absoluteImpactCents: number;
  }>;
  editableTargets: AgentEditableTarget[];
}

export type AgentToolCall =
  | { name: 'read_overview'; arguments: Record<string, never> }
  | {
      name: 'get_annual_series';
      arguments: { startYear: number | null; endYear: number | null };
    }
  | { name: 'inspect_year'; arguments: { year: number } }
  | {
      name: 'compare_child_timing';
      arguments: {
        startAge: number;
        endAge: number;
        spacingYears: number;
        monthlyCostCents: number | null;
        supportYears: number;
      };
    }
  | {
      name: 'compare_retirement_ages';
      arguments: { ages: number[] };
    }
  | { name: 'simulate_patch'; arguments: { patch: PlanPatch } }
  | { name: 'simulate_scenario'; arguments: { patches: PlanPatch[] } };

export type AgentDecision =
  | {
      type: 'answer';
      answer: string;
      evidence: string[];
      caveats: string[];
    }
  | { type: 'clarify'; question: string }
  | { type: 'tool'; reason: string; tool: AgentToolCall };

export interface AgentObservation {
  tool: AgentToolCall['name'];
  ok: boolean;
  result?: unknown;
  error?: string;
}

export interface AgentHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

export type AgentExpressionMode = 'strict' | 'enhanced' | 'autonomous';

export interface AgentTurnRequest {
  question: string;
  locale: string;
  context: LifeLedgerAgentContext;
  history: AgentHistoryMessage[];
  observations: AgentObservation[];
  preferences?: string[];
  step: number;
  /**
   * Strict mode never calls an external language model. Enhanced mode may send
   * only the separately constructed expression payload after user consent.
   * Autonomous mode may share the compact context and tool observations with
   * DeepSeek, but only after separate consent; it never writes a plan.
   */
  expressionMode?: AgentExpressionMode;
}
