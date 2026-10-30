import type { PlanPatch } from '../../analysis/action-patches';
import type { CityCostCandidate, HousingMode } from './city-cost-types';

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
  householdSize: number;
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
  | {
      name: 'get_investment_capacity';
      arguments: {
        startMonth: number;
        endMonthExclusive: number;
      };
    }
  | {
      name: 'lookup_city_costs';
      arguments: {
        fromCity: string;
        toCity: string;
        householdSize: number;
        housingMode: HousingMode;
      };
    }
  | {
      name: 'simulate_relocation_candidate';
      arguments: { relocationId: string };
    }
  | { name: 'simulate_patch'; arguments: { patch: PlanPatch } }
  | { name: 'simulate_scenario'; arguments: { patches: PlanPatch[] } };

export interface AgentQueryResolution {
  originalQuestion: string;
  resolvedQuestion: string;
  intent:
    | 'plan_fact'
    | 'simulation'
    | 'city_cost_lookup'
    | 'state_query'
    | 'safety_boundary'
    | 'conversation'
    | 'unknown';
  referencedEntity: {
    type: 'retirement' | 'purchase' | 'relocation' | 'investment' | 'year';
    id: string | null;
    label: string;
  } | null;
  cityPair: { fromCity: string; toCity: string } | null;
  unresolved: string[];
  preservedTerms: string[];
}

export type AgentSemanticIntent =
  | 'safety_boundary'
  | 'crisis_support'
  | 'capability'
  | 'system_explanation'
  | 'conversation'
  | 'feedback'
  | 'plan_overview'
  | 'plan_fact'
  | 'plan_explanation'
  | 'investment_capacity'
  | 'investment_scenario'
  | 'retirement_assessment'
  | 'city_choice'
  | 'city_cost_comparison'
  | 'relocation_simulation'
  | 'plan_change'
  | 'state_query'
  | 'unknown';

export type AgentBusinessSkillId =
  | 'ledger-insight'
  | 'scenario-planning'
  | 'relocation-planning';

export interface AgentPerception {
  version: '1.0.0';
  source: 'rule' | 'model' | 'fallback';
  intent: AgentSemanticIntent;
  confidence: 'high' | 'medium' | 'low';
  goal: string;
  entities: {
    cities: string[];
    years: number[];
    ages: number[];
    amountsCents: number[];
    durationsYears: number[];
  };
  constraints: string[];
  missingFields: string[];
  ambiguities: string[];
  suggestedSkillId: AgentBusinessSkillId | null;
}

export interface AgentPlanStep {
  id: string;
  kind: 'answer' | 'clarify' | 'tool' | 'confirm';
  tool: AgentToolCall['name'] | null;
  purpose: string;
  completionCondition: string;
}

export interface AgentPlan {
  version: '1.0.0';
  goal: string;
  skillId: AgentBusinessSkillId | null;
  status: 'ready' | 'needs_input' | 'blocked' | 'complete';
  steps: AgentPlanStep[];
  stopReason: string | null;
}

export interface AgentWorkingMemory {
  version: '1.0.0';
  taskId: string;
  planHash: string;
  goal: string;
  intent: AgentSemanticIntent;
  skillId: AgentBusinessSkillId | null;
  slots: AgentPerception['entities'];
  constraints: string[];
  missingFields: string[];
  ambiguities: string[];
  status:
    | 'collecting'
    | 'ready'
    | 'executing'
    | 'awaiting_confirmation'
    | 'completed'
    | 'failed';
  updatedAt: string;
}

export interface AgentShortTermState {
  version: '1.0.0';
  planHash: string;
  activeIntent: AgentQueryResolution['intent'] | null;
  referencedEntity: AgentQueryResolution['referencedEntity'];
  referencedYear: number | null;
  pendingCityCandidate: CityCostCandidate | null;
  lastToolFingerprints: string[];
  workingMemory?: AgentWorkingMemory | null;
  updatedAt: string;
}

export interface AgentMemoryContext {
  id: string;
  text: string;
  kind: 'communication' | 'decision_preference' | 'constraint';
  source: 'user_confirmed';
  status: 'active' | 'superseded' | 'deleted';
  effectiveFrom: string;
  expiresAt: string | null;
}

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
  durationMs?: number;
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
  memories?: AgentMemoryContext[];
  sessionState?: AgentShortTermState;
  step: number;
  /**
   * Local mode never calls an external language model. Enhanced mode sends
   * only the separately constructed expression payload. Autonomous mode is
   * the product default and may share compact context and tool observations
   * with DeepSeek when configured; it never writes a plan. The UI discloses
   * this behavior and lets the user persist a local-mode choice.
   */
  expressionMode?: AgentExpressionMode;
}

export interface AgentTurnTrace {
  id: string;
  totalMs: number;
  perceptionMs: number;
  planningMs: number;
  perceptionSource: AgentPerception['source'];
  intent: AgentSemanticIntent;
  confidence: AgentPerception['confidence'];
  skillId: AgentBusinessSkillId | null;
  decisionType: AgentDecision['type'];
  tool: AgentToolCall['name'] | null;
  fallbackReason: string | null;
  /** Client-observed duration across every API step and local tool call. */
  endToEndMs?: number;
  stepCount?: number;
  toolCallCount?: number;
  outcome?: 'answer' | 'clarify' | 'proposal' | 'error' | 'timeout';
}

export type AgentFeedbackReason =
  | 'misunderstood'
  | 'incorrect'
  | 'unclear'
  | 'slow'
  | 'other';

export interface AgentMessageFeedback {
  rating: 'helpful' | 'not_helpful';
  reason: AgentFeedbackReason | null;
  createdAt: string;
}
