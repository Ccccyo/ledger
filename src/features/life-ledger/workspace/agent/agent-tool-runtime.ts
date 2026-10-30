import { compareResults } from '../../analysis/digest-result';
import {
  calculateMonthlyLifePlan,
  type MonthlyCalculationResult,
} from '../../calculation';
import type { CashFlowItem, LifePlan } from '../../domain';
import { saveRelocation } from '../plan/relocation-mutations';
import { runReadOnlyAgentTool } from './agent-context';
import type { AgentObservation, AgentToolCall } from './agent-types';
import { isCityCostCandidate, type CityCostCandidate } from './city-cost-types';

export interface RelocationCandidateComparison {
  baselineHash: string;
  candidatePlan: LifePlan;
  candidateResult: MonthlyCalculationResult;
  change: ReturnType<typeof compareResults>;
  patch: {
    type: 'city-relocation-candidate';
    relocationId: string;
    fromCity: string;
    toCity: string;
    sourceLabel: string;
  };
}

function signedIncomeYuan(flow: CashFlowItem | undefined) {
  if (!flow) return 0;
  const amount = flow.amountCents / 100;
  return flow.direction === 'income' ? amount : -amount;
}

export function simulateRelocationCandidate(
  baseline: MonthlyCalculationResult,
  relocationId: string,
  candidate: CityCostCandidate
): RelocationCandidateComparison {
  const plan = baseline.input;
  const relocation = plan.metadata.relocations?.find(
    (item) => item.id === relocationId
  );
  if (!relocation) throw new Error('Relocation not found.');
  if (
    (relocation.currentCity ?? '') !== candidate.fromCity ||
    relocation.targetCity !== candidate.toCity
  ) {
    throw new Error('City candidate does not match this relocation.');
  }
  const incomeFlow = plan.standaloneCashFlows.find(
    (flow) => flow.id === relocation.incomeAdjustmentFlowId
  );
  const candidatePlan = saveRelocation(plan, {
    id: relocation.id,
    currentCity: relocation.currentCity,
    targetCity: relocation.targetCity,
    moveMonth: relocation.moveMonth,
    movingExpenseYuan: candidate.movingExpenseCandidateCents / 100,
    housingMonthlyChangeYuan: candidate.housingMonthlyChangeCents / 100,
    livingMonthlyChangeYuan: candidate.livingMonthlyChangeCents / 100,
    incomeMonthlyChangeYuan: signedIncomeYuan(incomeFlow),
    flowNames: {
      moving: 'MCP 城市候选 · 搬迁费',
      housing: 'MCP 城市候选 · 住房变化',
      living: 'MCP 城市候选 · 生活费变化',
      income: '用户已确认 · 收入变化',
    },
    source: {
      kind: 'external',
      label: `${candidate.source.provider} · ${candidate.source.datasetVersion}`,
      referenceUrl: candidate.source.referenceUrl ?? undefined,
      region: `${candidate.fromCity} → ${candidate.toCity}`,
      effectiveMonth: relocation.moveMonth,
      retrievedAt: candidate.source.retrievedAt,
    },
  });
  const candidateResult = calculateMonthlyLifePlan(candidatePlan);
  return {
    baselineHash: baseline.inputHash,
    candidatePlan,
    candidateResult,
    change: compareResults(baseline, candidateResult),
    patch: {
      type: 'city-relocation-candidate',
      relocationId,
      fromCity: candidate.fromCity,
      toCity: candidate.toCity,
      sourceLabel: `${candidate.source.provider} · ${candidate.source.datasetVersion}`,
    },
  };
}

export async function executeReadOnlyAgentTool(
  result: MonthlyCalculationResult,
  tool: Exclude<
    AgentToolCall,
    | { name: 'simulate_patch' | 'simulate_scenario' }
    | { name: 'simulate_relocation_candidate' }
  >,
  signal?: AbortSignal
): Promise<AgentObservation> {
  const startedAt = performance.now();
  if (tool.name !== 'lookup_city_costs') {
    const observation = runReadOnlyAgentTool(result, tool);
    return {
      ...observation,
      durationMs: Math.round(performance.now() - startedAt),
    };
  }
  try {
    const response = await fetch('/api/life-ledger/city-costs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tool.arguments),
      signal,
    });
    const payload = (await response.json()) as {
      candidate?: unknown;
      error?: string;
    };
    if (!response.ok || !isCityCostCandidate(payload.candidate)) {
      throw new Error(payload.error || 'City lookup returned invalid data.');
    }
    return {
      tool: tool.name,
      ok: true,
      result: payload.candidate,
      durationMs: Math.round(performance.now() - startedAt),
    };
  } catch (error) {
    return {
      tool: tool.name,
      ok: false,
      error: error instanceof Error ? error.message : 'City lookup failed.',
      durationMs: Math.round(performance.now() - startedAt),
    };
  }
}
