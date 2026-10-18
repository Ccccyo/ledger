import type { PlanPatch } from '../../analysis/action-patches';
import type { AgentDecision, AgentToolCall } from './agent-types';

const patchTypes = new Set([
  'shift-cash-flow',
  'change-cash-flow-amount',
  'change-retirement-month',
  'change-liquid-opening-balance',
  'shift-purchase',
  'remove-purchase',
  'shift-relocation',
  'remove-relocation',
]);

function finiteInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

export function parsePlanPatch(value: unknown): PlanPatch | null {
  if (!value || typeof value !== 'object') return null;
  const patch = value as Record<string, unknown>;
  if (typeof patch.type !== 'string' || !patchTypes.has(patch.type))
    return null;
  if (patch.type === 'change-retirement-month') {
    return finiteInteger(patch.retirementMonth)
      ? ({
          type: patch.type,
          retirementMonth: patch.retirementMonth,
        } as PlanPatch)
      : null;
  }
  if (patch.type === 'change-liquid-opening-balance') {
    return typeof patch.assetId === 'string' &&
      finiteInteger(patch.openingBalanceCents)
      ? ({
          type: patch.type,
          assetId: patch.assetId,
          openingBalanceCents: patch.openingBalanceCents,
        } as PlanPatch)
      : null;
  }
  if (patch.type === 'shift-purchase') {
    return typeof patch.purchaseId === 'string' &&
      finiteInteger(patch.monthDelta)
      ? ({
          type: patch.type,
          purchaseId: patch.purchaseId,
          monthDelta: patch.monthDelta,
        } as PlanPatch)
      : null;
  }
  if (patch.type === 'remove-purchase') {
    return typeof patch.purchaseId === 'string'
      ? ({ type: patch.type, purchaseId: patch.purchaseId } as PlanPatch)
      : null;
  }
  if (patch.type === 'shift-relocation') {
    return typeof patch.relocationId === 'string' &&
      finiteInteger(patch.monthDelta)
      ? ({
          type: patch.type,
          relocationId: patch.relocationId,
          monthDelta: patch.monthDelta,
        } as PlanPatch)
      : null;
  }
  if (patch.type === 'remove-relocation') {
    return typeof patch.relocationId === 'string'
      ? ({ type: patch.type, relocationId: patch.relocationId } as PlanPatch)
      : null;
  }
  if (typeof patch.cashFlowId !== 'string') return null;
  return patch.type === 'shift-cash-flow' && finiteInteger(patch.monthDelta)
    ? ({
        type: patch.type,
        cashFlowId: patch.cashFlowId,
        monthDelta: patch.monthDelta,
      } as PlanPatch)
    : patch.type === 'change-cash-flow-amount' &&
        finiteInteger(patch.amountCents)
      ? ({
          type: patch.type,
          cashFlowId: patch.cashFlowId,
          amountCents: patch.amountCents,
        } as PlanPatch)
      : null;
}

function parseTool(value: unknown): AgentToolCall | null {
  if (!value || typeof value !== 'object') return null;
  const tool = value as Record<string, unknown>;
  const args =
    tool.arguments && typeof tool.arguments === 'object'
      ? (tool.arguments as Record<string, unknown>)
      : {};
  if (tool.name === 'read_overview') {
    return { name: 'read_overview', arguments: {} };
  }
  if (tool.name === 'get_annual_series') {
    const startYear = args.startYear ?? null;
    const endYear = args.endYear ?? null;
    if (
      (startYear === null || finiteInteger(startYear)) &&
      (endYear === null || finiteInteger(endYear))
    ) {
      return { name: tool.name, arguments: { startYear, endYear } };
    }
  }
  if (tool.name === 'inspect_year' && finiteInteger(args.year)) {
    return { name: tool.name, arguments: { year: args.year } };
  }
  if (
    tool.name === 'compare_child_timing' &&
    finiteInteger(args.startAge) &&
    finiteInteger(args.endAge) &&
    finiteInteger(args.spacingYears) &&
    (args.monthlyCostCents === null || finiteInteger(args.monthlyCostCents)) &&
    finiteInteger(args.supportYears) &&
    args.startAge >= 18 &&
    args.endAge >= args.startAge &&
    args.spacingYears >= 1 &&
    args.spacingYears <= 10 &&
    (args.monthlyCostCents === null || args.monthlyCostCents > 0) &&
    args.supportYears >= 1 &&
    args.supportYears <= 30
  ) {
    return {
      name: tool.name,
      arguments: {
        startAge: args.startAge,
        endAge: args.endAge,
        spacingYears: args.spacingYears,
        monthlyCostCents: args.monthlyCostCents,
        supportYears: args.supportYears,
      },
    };
  }
  if (
    tool.name === 'compare_retirement_ages' &&
    Array.isArray(args.ages) &&
    args.ages.length >= 2 &&
    args.ages.length <= 5 &&
    args.ages.every(
      (age): age is number => finiteInteger(age) && age >= 40 && age <= 80
    )
  ) {
    return { name: tool.name, arguments: { ages: [...new Set(args.ages)] } };
  }
  if (tool.name === 'simulate_patch') {
    const patch = parsePlanPatch(args.patch);
    if (patch) return { name: tool.name, arguments: { patch } };
  }
  if (
    tool.name === 'simulate_scenario' &&
    Array.isArray(args.patches) &&
    args.patches.length >= 2 &&
    args.patches.length <= 3
  ) {
    const patches = args.patches.map(parsePlanPatch);
    if (patches.every((patch): patch is PlanPatch => patch !== null)) {
      return { name: tool.name, arguments: { patches } };
    }
  }
  return null;
}

export function parseAgentDecision(value: unknown): AgentDecision | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  if (item.type === 'answer' && typeof item.answer === 'string') {
    return {
      type: 'answer',
      answer: item.answer,
      evidence: Array.isArray(item.evidence)
        ? item.evidence.filter((v): v is string => typeof v === 'string')
        : [],
      caveats: Array.isArray(item.caveats)
        ? item.caveats.filter((v): v is string => typeof v === 'string')
        : [],
    };
  }
  if (item.type === 'clarify' && typeof item.question === 'string') {
    return { type: 'clarify', question: item.question };
  }
  if (item.type === 'tool' && typeof item.reason === 'string') {
    const tool = parseTool(item.tool);
    if (tool) return { type: 'tool', reason: item.reason, tool };
  }
  return null;
}
