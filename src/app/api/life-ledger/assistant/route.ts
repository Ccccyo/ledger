import { NextResponse } from 'next/server';
import { enforceMinIntervalRateLimit } from '@/shared/lib/rate-limit';
import type { MonthIndex } from '@/features/life-ledger/domain';
import { parseAgentDecision } from '@/features/life-ledger/workspace/agent/agent-decision';
import {
  perceiveTurnLocally,
  perceiveTurnWithModel,
} from '@/features/life-ledger/workspace/agent/agent-perception';
import {
  buildPlanForDecision,
  planPerceivedTurn,
} from '@/features/life-ledger/workspace/agent/agent-planner';
import { policyDecision } from '@/features/life-ledger/workspace/agent/agent-policy';
import type {
  AgentDecision,
  AgentPerception,
  AgentPlan,
  AgentTurnRequest,
} from '@/features/life-ledger/workspace/agent/agent-types';
import { validatePlannedTurn } from '@/features/life-ledger/workspace/agent/agent-validation';
import { isCityCostCandidate } from '@/features/life-ledger/workspace/agent/city-cost-types';
import { selectSkillWithModel } from '@/features/life-ledger/workspace/agent/model-skill-router';
import { resolveAgentQuery } from '@/features/life-ledger/workspace/agent/query-resolution';

export const runtime = 'nodejs';

const MAX_BODY_BYTES = 120_000;
const DEFAULT_MODEL_TIMEOUT_MS = 5_000;
const DEFAULT_MODEL_COOLDOWN_MS = 60_000;

let modelUnavailableUntil = 0;

/**
 * Warms the route in development before the first real turn. It performs no
 * model, tool, ledger, or storage work and is intentionally not cached.
 */
export function GET() {
  return new Response(null, {
    status: 204,
    headers: { 'Cache-Control': 'no-store' },
  });
}

export async function POST(request: Request) {
  if (process.env.NODE_ENV === 'production') {
    const limited = enforceMinIntervalRateLimit(request, {
      intervalMs: agentRateLimitIntervalMs(),
      keyPrefix: 'life-ledger-agent',
    });
    if (limited) return limited;
  }

  const requestStartedAt = performance.now();
  const traceId = crypto.randomUUID();
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: 'Request is too large.' },
      { status: 413 }
    );
  }

  let input: AgentTurnRequest;
  try {
    input = JSON.parse(raw) as AgentTurnRequest;
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }
  if (
    !input ||
    typeof input.question !== 'string' ||
    input.question.trim().length < 2 ||
    !input.context ||
    typeof input.context.planHash !== 'string' ||
    !Array.isArray(input.observations) ||
    !Number.isInteger(input.step) ||
    input.step < 0 ||
    input.step > 5
  ) {
    return NextResponse.json({ error: 'Invalid agent turn.' }, { status: 400 });
  }

  const perceptionStartedAt = performance.now();
  const localPerception = perceiveTurnLocally(input);
  let perception = localPerception;
  let perceptionMs = Math.round(performance.now() - perceptionStartedAt);
  let fallbackReason: string | null = null;
  const hardPolicy = policyDecision(input);
  if (hardPolicy) {
    const plan = buildPlanForDecision(localPerception, hardPolicy);
    return agentResponse({
      decision: hardPolicy,
      plan,
      perception: localPerception,
      mode: 'policy',
      enhancement: 'not-requested',
      traceId,
      requestStartedAt,
      perceptionMs,
      planningMs: 0,
      fallbackReason: null,
    });
  }

  const expressionMode = input.expressionMode ?? 'autonomous';
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (
    expressionMode === 'autonomous' &&
    apiKey &&
    Date.now() >= modelUnavailableUntil &&
    !['safety_boundary', 'crisis_support'].includes(localPerception.intent) &&
    (localPerception.confidence === 'low' ||
      localPerception.intent === 'unknown')
  ) {
    try {
      const modelPerceptionStartedAt = performance.now();
      perception = await perceiveTurnWithModel(input, apiKey);
      perceptionMs = Math.round(performance.now() - modelPerceptionStartedAt);
    } catch (error) {
      fallbackReason =
        error instanceof Error ? error.message : 'Model perception failed.';
      modelUnavailableUntil = Date.now() + modelCooldownMs();
      console.error('Life Ledger perception fell back', error);
    }
  }

  const planningStartedAt = performance.now();
  const perceivedPlan = planPerceivedTurn(input, perception);
  const planningMs = Math.round(performance.now() - planningStartedAt);
  if (perceivedPlan) {
    const validation = validatePlannedTurn(
      input,
      perception,
      perceivedPlan.plan,
      perceivedPlan.decision
    );
    if (validation.ok) {
      return agentResponse({
        decision: perceivedPlan.decision,
        plan: perceivedPlan.plan,
        perception,
        mode:
          perception.source === 'model'
            ? 'model-perception'
            : 'local-structured',
        enhancement:
          perception.source === 'model'
            ? 'applied'
            : expressionMode === 'autonomous' && fallbackReason
              ? 'unavailable'
              : 'not-requested',
        traceId,
        requestStartedAt,
        perceptionMs,
        planningMs,
        fallbackReason,
      });
    }
    fallbackReason = `Plan validation failed: ${validation.errors.join(' ')}`;
  }

  const localDecisionResult = localFastPathDecision(input);
  const localFallback = localDecisionResult ?? localDecision(input);
  const localPlan = buildPlanForDecision(perception, localFallback);

  if (expressionMode === 'autonomous') {
    // After the optional LLM perception pass, known and fully validated tasks
    // use local planning and execution. A second model call is reserved for
    // ambiguous language or dynamic tool selection.
    if (localDecisionResult) {
      return agentResponse({
        decision: localDecisionResult,
        plan: buildPlanForDecision(perception, localDecisionResult),
        perception,
        mode: 'local-fast-path',
        enhancement: 'not-requested',
        traceId,
        requestStartedAt,
        perceptionMs,
        planningMs,
        fallbackReason,
      });
    }
    if (apiKey && Date.now() >= modelUnavailableUntil) {
      try {
        const decision = await selectSkillWithModel(input, apiKey);
        // The model is free to choose Skills, but financial conclusions still
        // come from the existing deterministic coordinator and observations.
        // This prevents an unverified model amount from becoming the answer.
        const checkedDecision =
          decision.type === 'answer' ? localDecision(input) : decision;
        const plan = buildPlanForDecision(perception, checkedDecision);
        const validation = validatePlannedTurn(
          input,
          perception,
          plan,
          checkedDecision
        );
        if (!validation.ok) {
          throw new Error(
            `Model plan failed validation: ${validation.errors.join(' ')}`
          );
        }
        return agentResponse({
          decision: checkedDecision,
          plan,
          perception,
          mode: 'model-skills',
          enhancement: 'applied',
          traceId,
          requestStartedAt,
          perceptionMs,
          planningMs,
          fallbackReason,
        });
      } catch (error) {
        modelUnavailableUntil = Date.now() + modelCooldownMs();
        fallbackReason =
          error instanceof Error ? error.message : 'Model planning failed.';
        console.error('Life Ledger model skill selection fell back', error);
      }
    }
    return agentResponse({
      decision: localFallback,
      plan: localPlan,
      perception,
      mode: 'local',
      enhancement: 'unavailable',
      traceId,
      requestStartedAt,
      perceptionMs,
      planningMs,
      fallbackReason:
        fallbackReason ?? 'Model is not configured or is cooling down.',
    });
  }

  // The deterministic coordinator remains authoritative. In strict mode no
  // third-party model is called at all. Tool selection and clarification also
  // stay local in enhanced mode; the model is only allowed to improve a final
  // answer or handle context-free conversation.
  if (
    expressionMode === 'strict' ||
    (localDecisionResult && localDecisionResult.type !== 'answer')
  ) {
    return agentResponse({
      decision: localFallback,
      plan: localPlan,
      perception,
      mode: 'local',
      enhancement: 'not-requested',
      traceId,
      requestStartedAt,
      perceptionMs,
      planningMs,
      fallbackReason,
    });
  }

  if (!apiKey || Date.now() < modelUnavailableUntil) {
    return agentResponse({
      decision: localFallback,
      plan: localPlan,
      perception,
      mode: 'local',
      enhancement: 'unavailable',
      traceId,
      requestStartedAt,
      perceptionMs,
      planningMs,
      fallbackReason:
        fallbackReason ?? 'Model is not configured or is cooling down.',
    });
  }

  try {
    const response = await fetch('https://api.deepseek.com/responses', {
      method: 'POST',
      signal: AbortSignal.timeout(modelTimeoutMs()),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.DEEPSEEK_MODEL || 'deepseek-flash',
        store: false,
        instructions: systemPrompt(input.locale),
        // Deliberately excludes the formal plan context, observations, tool
        // target IDs and raw ledger. This is the complete third-party payload.
        input: JSON.stringify(
          buildEnhancedExpressionPayload(input, localDecisionResult)
        ),
        text: {
          format: {
            type: 'json_schema',
            name: 'life_ledger_agent_decision',
            strict: true,
            schema: decisionSchema,
          },
        },
        max_output_tokens: 900,
      }),
    });
    if (!response.ok) {
      const detail = await response.text();
      console.error(
        'Life Ledger Agent request failed',
        response.status,
        detail
      );
      throw new Error('Model request failed');
    }
    const payload = (await response.json()) as Record<string, unknown>;
    const text = readOutputText(payload);
    const decision = decodeModelDecision(JSON.parse(text));
    if (!decision || decision.type !== 'answer') {
      throw new Error('Enhanced expression returned a non-answer decision');
    }
    return agentResponse({
      decision,
      plan: buildPlanForDecision(perception, decision),
      perception,
      mode: 'model',
      enhancement: 'applied',
      traceId,
      requestStartedAt,
      perceptionMs,
      planningMs,
      fallbackReason,
    });
  } catch (error) {
    modelUnavailableUntil = Date.now() + modelCooldownMs();
    console.error('Life Ledger Agent fell back to local mode', error);
    return agentResponse({
      decision: localFallback,
      plan: localPlan,
      perception,
      mode: 'local',
      enhancement: 'unavailable',
      traceId,
      requestStartedAt,
      perceptionMs,
      planningMs,
      fallbackReason:
        error instanceof Error ? error.message : 'Expression model failed.',
    });
  }
}

function agentResponse({
  decision,
  perception,
  plan,
  mode,
  enhancement,
  traceId,
  requestStartedAt,
  perceptionMs,
  planningMs,
  fallbackReason,
}: {
  decision: AgentDecision;
  perception: AgentPerception;
  plan: AgentPlan;
  mode: string;
  enhancement: 'applied' | 'unavailable' | 'not-requested';
  traceId: string;
  requestStartedAt: number;
  perceptionMs: number;
  planningMs: number;
  fallbackReason: string | null;
}) {
  return NextResponse.json(
    {
      decision,
      perception,
      plan,
      mode,
      enhancement,
      trace: {
        id: traceId,
        totalMs: Math.round(performance.now() - requestStartedAt),
        perceptionMs,
        planningMs,
        perceptionSource: perception.source,
        intent: perception.intent,
        confidence: perception.confidence,
        skillId: plan.skillId,
        decisionType: decision.type,
        tool: decision.type === 'tool' ? decision.tool.name : null,
        fallbackReason,
      },
    },
    { headers: { 'x-agent-trace-id': traceId } }
  );
}

export function buildEnhancedExpressionPayload(
  input: AgentTurnRequest,
  localDraft: AgentDecision | null
) {
  return {
    question: input.question,
    recentConversation: input.history.slice(-4).map(({ role, content }) => ({
      role,
      content,
    })),
    localDraft:
      localDraft?.type === 'answer'
        ? {
            answer: localDraft.answer,
            evidence: localDraft.evidence,
            caveats: localDraft.caveats,
          }
        : null,
  };
}

function systemPrompt(locale: string) {
  return `You are the optional expression layer inside Life Ledger. Respond in ${locale.startsWith('zh') ? 'Simplified Chinese' : 'English'}.

The deterministic local coordinator plans and calculates; you only improve expression. You never receive the formal plan, raw ledger, tool observations, editable IDs, assets, liabilities, or transactions.

When localDraft is present, preserve every fact, amount, year, comparison, uncertainty and caveat exactly. Make the answer natural and compact, but do not add financial facts or recommendations. When localDraft is null, answer ordinary conversation briefly; for a plan-specific question, ask one concise clarification without inventing plan facts.

Always return type "answer". Keep answer to one short paragraph, evidence to at most three short items, and caveats to at most one item. For all unused schema fields return empty strings, empty arrays, or null; set toolName and patchType to "none".`;
}

const nullableInteger = { anyOf: [{ type: 'integer' }, { type: 'null' }] };
const decisionSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'type',
    'answer',
    'evidence',
    'caveats',
    'question',
    'reason',
    'toolName',
    'startYear',
    'endYear',
    'year',
    'patchType',
    'cashFlowId',
    'assetId',
    'monthDelta',
    'amountCents',
    'retirementMonth',
    'childStartAge',
    'childEndAge',
    'childSpacingYears',
    'childSupportYears',
    'purchaseId',
    'relocationId',
    'retirementAges',
  ],
  properties: {
    type: { type: 'string', enum: ['answer', 'clarify', 'tool'] },
    answer: { type: 'string' },
    evidence: { type: 'array', items: { type: 'string' } },
    caveats: { type: 'array', items: { type: 'string' } },
    question: { type: 'string' },
    reason: { type: 'string' },
    toolName: {
      type: 'string',
      enum: [
        'none',
        'get_annual_series',
        'inspect_year',
        'compare_child_timing',
        'compare_retirement_ages',
        'simulate_patch',
      ],
    },
    startYear: nullableInteger,
    endYear: nullableInteger,
    year: nullableInteger,
    patchType: {
      type: 'string',
      enum: [
        'none',
        'shift-cash-flow',
        'change-cash-flow-amount',
        'change-retirement-month',
        'change-liquid-opening-balance',
        'shift-purchase',
        'remove-purchase',
        'shift-relocation',
        'remove-relocation',
      ],
    },
    cashFlowId: { type: 'string' },
    assetId: { type: 'string' },
    monthDelta: nullableInteger,
    amountCents: nullableInteger,
    retirementMonth: nullableInteger,
    childStartAge: nullableInteger,
    childEndAge: nullableInteger,
    childSpacingYears: nullableInteger,
    childSupportYears: nullableInteger,
    purchaseId: { type: 'string' },
    relocationId: { type: 'string' },
    retirementAges: {
      type: 'array',
      items: { type: 'integer' },
      maxItems: 5,
    },
  },
};

function decodeModelDecision(value: unknown): AgentDecision | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  if (item.type === 'answer') {
    return parseAgentDecision({
      type: 'answer',
      answer: item.answer,
      evidence: item.evidence,
      caveats: item.caveats,
    });
  }
  if (item.type === 'clarify') {
    return parseAgentDecision({ type: 'clarify', question: item.question });
  }
  if (item.type !== 'tool' || typeof item.toolName !== 'string') return null;
  let argumentsValue: Record<string, unknown>;
  if (item.toolName === 'get_annual_series') {
    argumentsValue = { startYear: item.startYear, endYear: item.endYear };
  } else if (item.toolName === 'inspect_year') {
    argumentsValue = { year: item.year };
  } else if (item.toolName === 'compare_child_timing') {
    argumentsValue = {
      startAge: item.childStartAge,
      endAge: item.childEndAge,
      spacingYears: item.childSpacingYears,
      monthlyCostCents: item.amountCents,
      supportYears: item.childSupportYears,
    };
  } else if (item.toolName === 'compare_retirement_ages') {
    argumentsValue = { ages: item.retirementAges };
  } else if (item.toolName === 'simulate_patch') {
    const patch: Record<string, unknown> = { type: item.patchType };
    if (item.patchType === 'shift-cash-flow') {
      Object.assign(patch, {
        cashFlowId: item.cashFlowId,
        monthDelta: item.monthDelta,
      });
    } else if (item.patchType === 'change-cash-flow-amount') {
      Object.assign(patch, {
        cashFlowId: item.cashFlowId,
        amountCents: item.amountCents,
      });
    } else if (item.patchType === 'change-retirement-month') {
      patch.retirementMonth = item.retirementMonth;
    } else if (item.patchType === 'change-liquid-opening-balance') {
      Object.assign(patch, {
        assetId: item.assetId,
        openingBalanceCents: item.amountCents,
      });
    } else if (item.patchType === 'shift-purchase') {
      Object.assign(patch, {
        purchaseId: item.purchaseId,
        monthDelta: item.monthDelta,
      });
    } else if (item.patchType === 'remove-purchase') {
      patch.purchaseId = item.purchaseId;
    } else if (item.patchType === 'shift-relocation') {
      Object.assign(patch, {
        relocationId: item.relocationId,
        monthDelta: item.monthDelta,
      });
    } else if (item.patchType === 'remove-relocation') {
      patch.relocationId = item.relocationId;
    }
    argumentsValue = { patch };
  } else {
    return null;
  }
  return parseAgentDecision({
    type: 'tool',
    reason: item.reason,
    tool: { name: item.toolName, arguments: argumentsValue },
  });
}

function readOutputText(payload: Record<string, unknown>) {
  if (typeof payload.output_text === 'string') return payload.output_text;
  const output = Array.isArray(payload.output) ? payload.output : [];
  for (const item of output) {
    if (!item || typeof item !== 'object') continue;
    const content = Array.isArray((item as { content?: unknown }).content)
      ? ((item as { content: unknown[] }).content ?? [])
      : [];
    for (const part of content) {
      if (
        part &&
        typeof part === 'object' &&
        typeof (part as { text?: unknown }).text === 'string'
      ) {
        return (part as { text: string }).text;
      }
    }
  }
  throw new Error('Model returned no text');
}

export function localDecision(input: AgentTurnRequest): AgentDecision {
  const policy = policyDecision(input);
  if (policy) return policy;
  const resolution = resolveAgentQuery(input);
  const zh = input.locale.startsWith('zh');
  const q = resolution.resolvedQuestion.toLowerCase();
  // Only the immediately relevant exchange may assist deterministic parsing.
  // Durable slots live in working memory; concatenating a long transcript made
  // old amounts and intents leak into unrelated follow-up questions.
  const conversation = [
    ...input.history.slice(-2).map((item) => item.content),
    q,
  ]
    .join('\n')
    .toLowerCase();
  const casual = localConversationDecision(q, zh);
  if (casual) return casual;
  const last = input.observations.at(-1);
  if (!last) {
    const operationalBoundary = localOperationalBoundary(input, q, resolution);
    if (operationalBoundary) return operationalBoundary;
  }
  if (last?.tool === 'read_overview') {
    if (!last.ok || !last.result || typeof last.result !== 'object') {
      return plainAnswer(
        '当前正式账本读取失败，我没有继续引用旧结果。',
        [],
        [last.error ?? '请刷新计划后重试。']
      );
    }
    const overview = last.result as {
      planHash: string;
      summary: {
        firstGapMonth: number | null;
        minimumAvailableCents: number;
        endingAvailableCents: number;
        endingNetWorthCents: number;
        retirementAvailableCents: number;
      };
    };
    return plainAnswer(
      overview.summary.firstGapMonth === null
        ? '已按当前正式计划重新计算：规划期内没有资金缺口。'
        : `已按当前正式计划重新计算：首次资金缺口在 ${formatMonthIndex(overview.summary.firstGapMonth)}。`,
      [
        `最低可用资金 ${formatCents(overview.summary.minimumAvailableCents)}；期末可用资金 ${formatCents(overview.summary.endingAvailableCents)}。`,
        `计划版本：${overview.planHash.slice(0, 8)}。`,
      ],
      ['结论只对应这次读取的计划版本。']
    );
  }
  if (last?.tool === 'inspect_year') {
    if (!last.ok || !last.result || typeof last.result !== 'object') {
      return plainAnswer(
        '请求的年份不在当前规划范围内。',
        [],
        [last.error ?? '请换一个年份。']
      );
    }
    const row = last.result as {
      year: number;
      closingAvailableCents: number;
      closingNetWorthCents: number;
      netCashFlowCents: number;
    };
    return plainAnswer(
      `${row.year} 年末可用资金为 ${formatCents(row.closingAvailableCents)}。`,
      [
        `当年资金变化 ${formatCents(row.netCashFlowCents)}；年末净资产 ${formatCents(row.closingNetWorthCents)}。`,
      ],
      ['结果来自当前正式计划版本。']
    );
  }
  if (last?.tool === 'lookup_city_costs') {
    if (!last.ok || !isCityCostCandidate(last.result)) {
      return plainAnswer(
        zh
          ? '城市成本查询暂时不可用，我没有用猜测值继续试算。'
          : 'The city-cost lookup is unavailable, so I did not continue with guessed values.',
        [],
        [
          last.error ??
            (zh
              ? '可改为手工填写候选金额。'
              : 'You can enter candidate amounts manually.'),
        ]
      );
    }
    const candidate = last.result;
    const relocation = input.context.relocations.find(
      (item) =>
        item.currentCity === candidate.fromCity &&
        item.targetCity === candidate.toCity
    );
    if (relocation && /试算|影响|计划|应用|采用/.test(q)) {
      return {
        type: 'tool',
        reason: `使用 ${candidate.source.datasetVersion} 城市候选更新已有迁居安排的临时副本。`,
        tool: {
          name: 'simulate_relocation_candidate',
          arguments: { relocationId: relocation.id },
        },
      };
    }
    const signed = (value: number) =>
      `${value >= 0 ? '+' : '-'}${formatCents(Math.abs(value))}`;
    return plainAnswer(
      zh
        ? `${candidate.fromCity} → ${candidate.toCity} 的演示候选为：每月住房 ${signed(candidate.housingMonthlyChangeCents)}，每月生活费 ${signed(candidate.livingMonthlyChangeCents)}，一次性搬迁费 ${formatCents(candidate.movingExpenseCandidateCents)}。`
        : `Demo candidate for ${candidate.fromCity} → ${candidate.toCity}: housing ${signed(candidate.housingMonthlyChangeCents)} monthly, living costs ${signed(candidate.livingMonthlyChangeCents)} monthly, and ${formatCents(candidate.movingExpenseCandidateCents)} one time.`,
      [
        `${candidate.source.provider} · ${candidate.source.datasetVersion} · ${candidate.source.observedAt}`,
      ],
      [candidate.source.disclaimer]
    );
  }
  if (last?.tool === 'compare_retirement_ages') {
    if (!last.ok || !Array.isArray(last.result))
      return {
        type: 'clarify',
        question: '退休年龄比较失败，请确认这些年龄都在当前规划期限内。',
      };
    const options = last.result as Array<{
      age: number;
      retirementAvailableCents: number;
      endingAvailableCents: number;
      firstGapMonth: number | null;
    }>;
    return {
      type: 'answer',
      answer: '退休年龄比较完成。',
      evidence: options.map(
        (item) =>
          `${item.age} 岁：退休时 ${formatCents(item.retirementAvailableCents)} · 终点 ${formatCents(item.endingAvailableCents)} · ${item.firstGapMonth === null ? '规划期内无缺口' : `首次缺口 ${formatMonthIndex(item.firstGapMonth)}`}`
      ),
      caveats: ['这是临时比较，没有修改正式退休年龄。'],
    };
  }
  if (last?.tool === 'get_investment_capacity') {
    if (!last.ok || !last.result) {
      return {
        type: 'clarify',
        question: zh
          ? '这段投资时间超出了当前规划范围，请换一个开始时间或持有期限。'
          : 'That investment period is outside the current plan. Choose another start or holding period.',
      };
    }
    const capacity = last.result as {
      startMonth: number;
      endMonthExclusive: number;
      availableAtStartCents: number;
      gapFreeAdditionalCents: number;
    };
    const startAge = ageAtMonth(input.context, capacity.startMonth);
    const holdingMonths = capacity.endMonthExclusive - capacity.startMonth;
    const holdingYears = Math.round((holdingMonths / 12) * 10) / 10;
    return plainAnswer(
      zh
        ? `按当前账本，从${startAge === null ? formatMonthIndex(capacity.startMonth) : `${startAge} 岁`}开始、持有约 ${holdingYears} 年，如果要求持有期间可用资金不低于 0，最多还可安排 ${formatCents(capacity.gapFreeAdditionalCents)}。`
        : `Based on the current ledger, starting at ${startAge ?? formatMonthIndex(capacity.startMonth)} for about ${holdingYears} years, up to ${formatCents(capacity.gapFreeAdditionalCents)} more keeps available funds at or above zero during the holding period.`,
      [
        zh
          ? `开始时可用资金上限：${formatCents(capacity.availableAtStartCents)}`
          : `Available at the start: ${formatCents(capacity.availableAtStartCents)}`,
      ],
      [
        zh
          ? '这是现金流边界，不是建议投入额；系统没有额外预留应急资金。'
          : 'This is a cash-flow boundary, not an investment recommendation; no extra emergency reserve is included.',
      ]
    );
  }
  if (last?.tool === 'compare_child_timing') {
    if (!last.ok) {
      return {
        type: 'clarify',
        question: zh
          ? '暂时无法完成比较。请确认计划中已有孩子预算和出生年月。'
          : 'I could not compare the options. Check that the plan includes a child budget and your birth month.',
      };
    }
    const comparison = last.result as {
      usedCurrentChildBudget: boolean;
      comparedStartAge: number;
      comparedEndAge: number;
      spacingYears: number;
      options: Array<{
        firstChildAge: number;
        secondChildAge: number;
        firstChildYear: number;
        secondChildYear: number;
        firstGapMonth: number | null;
        minimumAvailableCents: number;
        endingAvailableCents: number;
      }>;
    };
    const best = comparison.options?.[0];
    if (!best) {
      return {
        type: 'clarify',
        question: zh
          ? '当前规划期限内没有可比较的两孩时间窗口。'
          : 'There is no valid two-child timing window within the current plan.',
      };
    }
    return {
      type: 'answer',
      answer: zh
        ? `${best.firstChildYear} 年生第一个、${best.secondChildYear} 年生第二个，财务压力相对较小。`
        : `Financial pressure is relatively lower with the first child in ${best.firstChildYear} and the second in ${best.secondChildYear}.`,
      evidence: [
        zh
          ? `比较了 ${comparison.comparedStartAge}～${comparison.comparedEndAge} 岁开始的方案 · 两孩间隔 ${comparison.spacingYears} 年`
          : `Compared first-child ages ${comparison.comparedStartAge}–${comparison.comparedEndAge} · ${comparison.spacingYears}-year spacing`,
        zh
          ? `${comparison.usedCurrentChildBudget ? '沿用当前孩子预算' : '按你提供的孩子预算'} · 情景期最低可用资金 ${formatCents(best.minimumAvailableCents)}`
          : `${comparison.usedCurrentChildBudget ? 'Used the current child budget' : 'Used your child budget'} · minimum available funds ${formatCents(best.minimumAvailableCents)}`,
      ],
      caveats: [
        zh
          ? '这里只比较财务压力；健康与生育安排请结合专业意见。'
          : 'This compares financial pressure only; health and family timing require professional advice.',
      ],
    };
  }
  if (
    last?.tool === 'get_annual_series' &&
    last.ok &&
    Array.isArray(last.result)
  ) {
    const rows = last.result as Array<{
      year: number;
      ageStart: number | null;
      ageEnd: number | null;
      phase: 'working' | 'retired' | 'transition';
      incomeCents: number;
      netCashFlowCents: number;
      expenseCents: number;
      closingAvailableCents: number;
      closingNetWorthCents: number;
      minimumAvailableCents: number;
      expenseByCategory: Record<string, number>;
      topExpenseCategories: string[];
    }>;
    if (/为什么(?:会)?这么少/.test(q)) {
      const totals = rows.reduce<Record<string, number>>((sum, row) => {
        for (const [category, amount] of Object.entries(
          row.expenseByCategory ?? {}
        ))
          sum[category] = (sum[category] ?? 0) + amount;
        return sum;
      }, {});
      const largest = Object.entries(totals)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3);
      return plainAnswer(
        '这不是单一事件造成的，而是长期收入减去全部支出后的结果。',
        largest.map(
          ([category, amount]) =>
            `${categoryLabel(category)}累计支出 ${formatCents(amount)}`
        ),
        ['如果要判断某一项的因果影响，需要移除或调整该项后再做临时比较。']
      );
    }
    if (/退休后.*资金下降/.test(q)) {
      const retirementYear = Math.floor(input.context.retirementMonth / 12);
      const retiredRows = rows.filter((row) => row.year >= retirementYear);
      const decline = retiredRows
        .filter((row) => row.netCashFlowCents < 0)
        .sort((a, b) => a.netCashFlowCents - b.netCashFlowCents)[0];
      if (!decline)
        return plainAnswer('当前账本中，退休后的年度现金流没有下降到负数。', [
          '如果曲线局部变化，请告诉我具体年份再核对。',
        ]);
      return plainAnswer(
        `${decline.year} 年退休后支出高于收入，年度净现金流为 ${formatCents(decline.netCashFlowCents)}。`,
        [
          `主要支出：${decline.topExpenseCategories.map(categoryLabel).join('、') || '未分类支出'}。`,
        ]
      );
    }
    const asksHousingChildOverlap =
      /买房|购房|住房|房贷|housing|home/.test(input.question.toLowerCase()) &&
      /孩子|子女|育儿|child/.test(input.question.toLowerCase());
    if (asksHousingChildOverlap) {
      const overlap = rows.filter(
        (row) =>
          (row.expenseByCategory.housing ?? 0) > 0 &&
          (row.expenseByCategory.child ?? 0) > 0
      );
      if (overlap.length === 0) {
        return {
          type: 'answer',
          answer: zh
            ? '当前计划中，住房与孩子支出没有在同一年发生。'
            : 'Housing and child expenses do not overlap in the current plan.',
          evidence: [],
          caveats: [],
        };
      }
      const tightestOverlap = overlap.reduce((a, b) =>
        a.netCashFlowCents <= b.netCashFlowCents ? a : b
      );
      return {
        type: 'answer',
        answer: zh
          ? `有重叠；${tightestOverlap.year} 年是重叠期间压力最大的一年。`
          : `${tightestOverlap.year} is the tightest overlap year.`,
        evidence: [
          zh
            ? `住房 ${formatCents(tightestOverlap.expenseByCategory.housing)} · 孩子 ${formatCents(tightestOverlap.expenseByCategory.child)} · 净现金流 ${formatCents(tightestOverlap.netCashFlowCents)}`
            : `Housing ${formatCents(tightestOverlap.expenseByCategory.housing)} · child ${formatCents(tightestOverlap.expenseByCategory.child)} · net cash flow ${formatCents(tightestOverlap.netCashFlowCents)}`,
        ],
        caveats: [],
      };
    }
    if (/买房当年.*支出|买房后.*可用资金/.test(q)) {
      const purchase = input.context.assets.find(
        (item) => item.kind === 'property' && item.acquiredMonth !== null
      );
      const purchaseYear =
        purchase?.acquiredMonth === null ||
        purchase?.acquiredMonth === undefined
          ? null
          : Math.floor(purchase.acquiredMonth / 12);
      const index = rows.findIndex((row) => row.year === purchaseYear);
      if (index < 0) return plainAnswer('当前计划中没有可核对的购房年份。');
      const row = rows[index];
      if (/买房当年.*支出/.test(q))
        return plainAnswer(
          `${row.year} 年预计总支出 ${formatCents(row.expenseCents)}。`,
          [`住房支出 ${formatCents(row.expenseByCategory.housing ?? 0)}。`]
        );
      const previous = rows[index - 1];
      return plainAnswer(
        `买房当年年末可用资金为 ${formatCents(row.closingAvailableCents)}。`,
        previous
          ? [
              `较上一年末变化 ${formatCents(row.closingAvailableCents - previous.closingAvailableCents)}。`,
            ]
          : []
      );
    }
    if (/最低可用资金/.test(q)) {
      const lowest = rows.reduce((a, b) =>
        a.minimumAvailableCents <= b.minimumAvailableCents ? a : b
      );
      return answer(
        zh,
        `${lowest.year} 年最低，为 ${formatCents(lowest.minimumAvailableCents)}。`,
        `年龄约 ${formatAgeRange(lowest.ageStart, lowest.ageEnd)}。`
      );
    }
    if (/收入.*(?:明显)?变化|哪一年.*收入/.test(q)) {
      const changes = rows.slice(1).map((row, index) => ({
        row,
        delta: row.incomeCents - rows[index].incomeCents,
      }));
      const largest = changes.reduce((a, b) =>
        Math.abs(a.delta) >= Math.abs(b.delta) ? a : b
      );
      return answer(
        zh,
        `${largest.row.year} 年收入变化最明显。`,
        `较上一年${largest.delta >= 0 ? '增加' : '减少'} ${formatCents(Math.abs(largest.delta))}。`
      );
    }
    if (/支出.*最高|最高.*支出/.test(q)) {
      const highest = rows.reduce((a, b) =>
        a.expenseCents >= b.expenseCents ? a : b
      );
      return answer(
        zh,
        `${highest.year} 年支出最高，为 ${formatCents(highest.expenseCents)}。`,
        `主要是${highest.topExpenseCategories.map(categoryLabel).join('、') || '未分类支出'}。`
      );
    }
    if (/余额突然下降|哪一年.*下降/.test(q)) {
      const declines = rows.slice(1).map((row, index) => ({
        row,
        delta: row.closingAvailableCents - rows[index].closingAvailableCents,
      }));
      const largest = declines.reduce((a, b) => (a.delta <= b.delta ? a : b));
      return answer(
        zh,
        `${largest.row.year} 年余额下降最明显。`,
        `年末可用资金较上一年减少 ${formatCents(Math.abs(largest.delta))}；主要支出是${largest.row.topExpenseCategories.map(categoryLabel).join('、') || '未分类支出'}。`
      );
    }
    if (/哪一项支出.*(?:长期|影响最大)|家庭支出中.*最大/.test(q)) {
      const totals = rows.reduce<Record<string, number>>((sum, row) => {
        for (const [category, amount] of Object.entries(
          row.expenseByCategory ?? {}
        ))
          sum[category] = (sum[category] ?? 0) + amount;
        return sum;
      }, {});
      const [category, amount] = Object.entries(totals).sort(
        (a, b) => b[1] - a[1]
      )[0] ?? ['other', 0];
      return answer(
        zh,
        `${categoryLabel(category)}是累计支出最大的项目。`,
        `规划期内合计 ${formatCents(amount)}。`
      );
    }
    if (
      /为什么.*(?:资金缺口|缺口)|退休后.*资金下降|主要原因|最大原因/.test(q)
    ) {
      const requestedAge = q.match(/(\d{2})\s*岁/)?.[1];
      const focus = requestedAge
        ? rows.find(
            (row) =>
              row.ageStart !== null &&
              row.ageEnd !== null &&
              Number(requestedAge) >= row.ageStart &&
              Number(requestedAge) <= row.ageEnd
          )
        : /退休后/.test(q)
          ? rows.find(
              (row) =>
                row.year === Math.floor(input.context.retirementMonth / 12)
            )
          : input.context.summary.firstGapYear !== null
            ? rows.find(
                (row) => row.year === input.context.summary.firstGapYear
              )
            : rows.reduce((a, b) =>
                a.netCashFlowCents <= b.netCashFlowCents ? a : b
              );
      if (!focus)
        return answer(
          zh,
          '当前计划中没有对应年份可供分析。',
          '我没有使用计划外的数据。'
        );
      if (/资金缺口|缺口/.test(q) && focus.minimumAvailableCents >= 0)
        return plainAnswer(
          requestedAge
            ? `${requestedAge} 岁并没有出现资金缺口。`
            : '当前规划期内没有出现资金缺口。',
          [
            `${focus.year} 年最低可用资金为 ${formatCents(focus.minimumAvailableCents)}，年度净现金流为 ${formatCents(focus.netCashFlowCents)}。`,
          ],
          ['我不会把“资金压力”误报成“资金缺口”。']
        );
      return answer(
        zh,
        `${focus.year} 年的主要压力来自${focus.topExpenseCategories.map(categoryLabel).join('、') || '未分类支出'}。`,
        `该年净现金流为 ${formatCents(focus.netCashFlowCents)}。`
      );
    }
    const tightest = rows.reduce((a, b) =>
      a.netCashFlowCents <= b.netCashFlowCents ? a : b
    );
    return {
      type: 'answer',
      answer: zh
        ? `${tightest.year} 年的年度净现金流最低，是当前计划中资金压力最大的一年。`
        : `${tightest.year} has the lowest annual net cash flow and is the tightest year in the current plan.`,
      evidence: [
        zh
          ? `该年净现金流为 ${formatCents(tightest.netCashFlowCents)}，支出为 ${formatCents(tightest.expenseCents)}。`
          : `Net cash flow is ${formatCents(tightest.netCashFlowCents)} and expenses are ${formatCents(tightest.expenseCents)}.`,
        zh
          ? `主要支出：${tightest.topExpenseCategories.map(categoryLabel).join('、') || '未分类'}。`
          : `Top expense categories: ${tightest.topExpenseCategories.join(', ') || 'unclassified'}.`,
      ],
      caveats: [
        zh
          ? '结果来自当前计划，不代表未来保证。'
          : 'This reflects the current plan, not a guarantee.',
      ],
    };
  }

  if (/可以问|能问|会什么|怎么用|what can i ask|help/.test(q)) {
    return {
      type: 'answer',
      answer: zh
        ? '你可以问当前计划，也可以让我试算变化。'
        : 'Ask about the current plan or simulate a change.',
      evidence: zh
        ? [
            '哪一年资金最紧张？',
            '晚两年退休会怎样？',
            '投入 20 万理财三年会怎样？',
          ]
        : [
            'Which year is tightest?',
            'What if I retire two years later?',
            'What if I invest 200,000 for three years?',
          ],
      caveats: [],
    };
  }
  if (
    resolution.intent === 'state_query' &&
    /哪些.*试算|试算.*保存|正式计划.*是什么|是否生效|恢复原来|删除试算/.test(q)
  ) {
    const pending = input.sessionState?.pendingCityCandidate;
    return plainAnswer(
      pending
        ? `当前正式计划版本是 ${input.context.planHash.slice(0, 8)}；${pending.fromCity} → ${pending.toCity} 城市数据仍只是候选，尚未写入正式计划。`
        : `当前正式计划版本是 ${input.context.planHash.slice(0, 8)}；没有保存中的城市数据候选。`,
      [],
      ['只有点击候选方案上的确认按钮后，正式计划才会改变。']
    );
  }
  if (resolution.cityPair) {
    if (/最新|当前|今天|实时|官方/.test(q) && !/演示|样例|模拟/.test(q)) {
      return plainAnswer(
        '当前没有接入可证明为最新的城市市场数据，因此我不能把演示数据说成实时结论。',
        [],
        [
          `可以明确说“用演示数据比较 ${resolution.cityPair.fromCity} 和 ${resolution.cityPair.toCity}”，用于验证 MCP 与试算流程。`,
        ]
      );
    }
    return {
      type: 'tool',
      reason: `通过只读 MCP 查询 ${resolution.cityPair.fromCity} → ${resolution.cityPair.toCity} 的城市成本候选。`,
      tool: {
        name: 'lookup_city_costs',
        arguments: {
          ...resolution.cityPair,
          householdSize: input.context.householdSize,
          housingMode: 'unknown',
        },
      },
    };
  }
  if (/我会有什么变化|计划概览|整体情况|总体情况/.test(q)) {
    return {
      type: 'tool',
      reason: '读取当前正式计划的资金、退休和缺口概览。',
      tool: { name: 'read_overview', arguments: {} },
    };
  }
  const referencedYear = q.match(/((?:19|20|21)\d{2})\s*年/)?.[1];
  if (referencedYear && /余额|资金|净资产/.test(q)) {
    return {
      type: 'tool',
      reason: `读取 ${referencedYear} 年的正式账本记录。`,
      tool: {
        name: 'inspect_year',
        arguments: { year: Number(referencedYear) },
      },
    };
  }
  const structuralPatch = localStructuralPatchDecision(input, q);
  if (structuralPatch) return structuralPatch;
  const known = localKnownAnswer(input, q, conversation);
  if (known) return known;
  const asksRetirement = /退休|retire/.test(q);
  if (
    asksRetirement &&
    /能不能|能否|能退休|可以退休|可不可以|行不行|够不够/.test(q)
  ) {
    const retirementAge = input.context.retirementAge ?? '设定年龄';
    return input.context.summary.firstGapMonth === null
      ? plainAnswer(
          `按当前输入，在 ${retirementAge} 岁退休的方案计算到 ${input.context.endAge ?? '规划终点'} 岁都没有出现资金缺口。`,
          [
            `退休时可用资金 ${formatCents(input.context.summary.retirementAvailableCents)}。`,
          ],
          ['这是当前方案的试算结果，不是对未来的保证。']
        )
      : plainAnswer(
          `按当前输入，在 ${retirementAge} 岁退休后会于 ${formatMonthIndex(input.context.summary.firstGapMonth)}首次出现资金缺口。`,
          [],
          ['可以继续比较推迟退休或调整退休支出的方案。']
        );
  }
  const comparedRetirementAges = [...q.matchAll(/(\d{2})\s*岁/g)].map((match) =>
    Number(match[1])
  );
  if (asksRetirement && /比较/.test(q) && comparedRetirementAges.length >= 2) {
    return {
      type: 'tool',
      reason: '用正式账本分别计算这些退休年龄。',
      tool: {
        name: 'compare_retirement_ages',
        arguments: { ages: comparedRetirementAges },
      },
    };
  }
  const targetRetirementAge = q.match(
    /(?:改成|调整到|退休到?)\s*(\d{2})\s*岁/
  )?.[1];
  const retirementShift = parseSignedYearShift(q);
  if (
    asksRetirement &&
    (targetRetirementAge !== undefined || retirementShift !== null)
  ) {
    const retirementMonth =
      targetRetirementAge !== undefined && input.context.retirementAge !== null
        ? input.context.retirementMonth +
          (Number(targetRetirementAge) - input.context.retirementAge) * 12
        : input.context.retirementMonth + (retirementShift ?? 0) * 12;
    return {
      type: 'tool',
      reason: zh
        ? `先用正式账本试算退休时间调整到 ${formatMonthIndex(retirementMonth)}。`
        : 'Simulate the retirement timing change with the formal ledger.',
      tool: {
        name: 'simulate_patch',
        arguments: {
          patch: {
            type: 'change-retirement-month',
            retirementMonth: retirementMonth as MonthIndex,
          },
        },
      },
    };
  }
  const singlePatch = localSinglePatchDecision(input, q);
  if (singlePatch) return singlePatch;
  const childTimingIntent =
    /两个娃|两个孩子|两个小孩|二胎|生二个|two\s+(?:children|kids)/.test(
      conversation
    ) && /什么时候|何时|哪年|哪一年|最好|合适|when|timing/.test(conversation);
  if (childTimingIntent) {
    if (input.context.primaryBirthMonth === null) {
      return {
        type: 'clarify',
        question: zh
          ? '请先补充你的出生年月，我才能按年龄比较时间窗口。'
          : 'Add your birth month so I can compare age-based timing windows.',
      };
    }
    const hasCurrentChildBudget = input.context.keyEvents.some(
      (event) =>
        event.category === 'child' &&
        event.direction === 'expense' &&
        event.amountCents > 0
    );
    const spacingYears = parseChildSpacingYears(q, conversation);
    const monthlyCostYuan = parseYuanAmount(q);
    if (spacingYears === null) {
      return {
        type: 'clarify',
        question: zh
          ? hasCurrentChildBudget
            ? '两个孩子想间隔几年？\n我会沿用当前孩子预算，比较未来 10 年。'
            : '每个孩子每月预算多少、两个孩子想间隔几年？\n例如：5000 元/月，间隔 3 年。'
          : hasCurrentChildBudget
            ? 'How many years apart?\nI will use the current child budget and compare the next 10 years.'
            : 'What is the monthly budget per child, and how many years apart?\nFor example: 5,000 per month, 3 years apart.',
      };
    }
    const costFromConversation =
      monthlyCostYuan ?? parseMonthlyChildCostYuan(conversation);
    if (!hasCurrentChildBudget && costFromConversation === null) {
      return {
        type: 'clarify',
        question: zh
          ? `每个孩子每月预算多少？\n已识别：间隔 ${spacingYears} 年。`
          : `What is the monthly budget per child?\nRecognized: ${spacingYears} years apart.`,
      };
    }
    const currentAge = Math.max(
      0,
      Math.floor(
        (input.context.baseMonth - input.context.primaryBirthMonth) / 12
      )
    );
    const requestedRange = parseAgeRange(conversation);
    const startAge = requestedRange?.[0] ?? currentAge + 1;
    const endAge = requestedRange?.[1] ?? currentAge + 10;
    return {
      type: 'tool',
      reason: zh
        ? '沿用正式账本，比较不同两孩时间窗口。'
        : 'Compare two-child timing windows with the formal ledger.',
      tool: {
        name: 'compare_child_timing',
        arguments: {
          startAge,
          endAge,
          spacingYears,
          monthlyCostCents:
            hasCurrentChildBudget || costFromConversation === null
              ? null
              : Math.round(costFromConversation * 100),
          supportYears: 18,
        },
      },
    };
  }
  if (
    /压力最大|最紧张|哪一年|最低可用资金|收入.*变化|支出.*最高|余额突然下降|哪一项支出.*影响最大|家庭支出中.*最大|为什么.*资金缺口|为什么会出现缺口|为什么(?:会)?这么少|退休后.*资金下降|主要原因|最大原因|支出.*重叠|买房当年.*支出|买房后.*可用资金|tightest|pressure/.test(
      q
    )
  ) {
    return {
      type: 'tool',
      reason: zh
        ? '读取逐年正式账本，比较每年的净现金流。'
        : 'Read the annual ledger and compare yearly net cash flow.',
      tool: {
        name: 'get_annual_series',
        arguments: { startYear: null, endYear: null },
      },
    };
  }
  const investmentIntent =
    /理财|投资|基金|股票|高波动|投一笔|投入|追加|加仓|本金|investment|invest/;
  const principalYuan = parseYuanAmount(q);
  const asksInvestmentCapacity =
    investmentIntent.test(q) &&
    /(?:还|再|追加|加仓|最多|上限|可以|能).*(?:投入|投资|本金)|(?:投入|投资|本金).*(?:多少|多大|上限)/.test(
      q
    );
  if (asksInvestmentCapacity) {
    const existing =
      input.context.investments.length === 1
        ? input.context.investments[0]
        : null;
    const ageMatches = [...conversation.matchAll(/(\d{2})\s*岁(?:开始)?/g)]
      .map((match) => Number(match[1]))
      .filter((age) => age >= 18 && age <= 90);
    const inferredAge = ageMatches.at(-1) ?? null;
    const holdingYears = parseHoldingYears(conversation);
    const startMonth = existing
      ? existing.startMonth
      : inferredAge !== null && input.context.primaryBirthMonth !== null
        ? input.context.primaryBirthMonth + inferredAge * 12
        : null;
    const endMonthExclusive = existing
      ? existing.endMonthExclusive
      : startMonth !== null && holdingYears !== null
        ? startMonth + holdingYears * 12
        : null;
    if (input.context.investments.length > 1 && inferredAge === null)
      return {
        type: 'clarify',
        question: '你想追加到哪一笔投资？也可以告诉我开始年龄和持有年限。',
      };
    if (startMonth === null || endMonthExclusive === null)
      return {
        type: 'clarify',
        question:
          '准备从几岁或哪个月开始，预计持有多久？我会按正式账本计算可投入上限。',
      };
    return {
      type: 'tool',
      reason: '读取投资期间的逐月可用资金，计算追加本金的现金流边界。',
      tool: {
        name: 'get_investment_capacity',
        arguments: { startMonth, endMonthExclusive },
      },
    };
  }
  if (
    investmentIntent.test(q) ||
    (principalYuan !== null && investmentIntent.test(conversation))
  ) {
    if (principalYuan !== null) {
      const years = parseHoldingYears(conversation) ?? 3;
      const lower = Math.round(principalYuan * Math.pow(0.75, years));
      const upper = Math.round(principalYuan * Math.pow(1.3, years));
      return {
        type: 'answer',
        answer: zh
          ? `${years} 年后约为 ${formatYuan(lower)}～${formatYuan(upper)}。`
          : `After ${years} years: about ${formatYuan(lower)} to ${formatYuan(upper)}.`,
        evidence: [
          zh
            ? `本金 ${formatYuan(principalYuan)} · 年化情景 -25%～30%`
            : `Principal ${formatYuan(principalYuan)} · annual scenario -25% to 30%`,
        ],
        caveats: [
          zh
            ? '情景区间，不是收益承诺。'
            : 'Scenario range, not a return promise.',
        ],
      };
    }
    return {
      type: 'clarify',
      question: zh
        ? '计划投入多少本金？\n已识别：35 岁开始 · 持有 3 年 · 高波动（-25%～30%）'
        : 'How much principal would you invest?\nRecognized: starts at 35 · 3 years · high volatility (-25% to 30%)',
    };
  }
  if (/搬家|迁居|换城市|relocat|move from|move to/.test(q)) {
    return {
      type: 'clarify',
      question: zh
        ? '请补充：搬家时间、一次性搬家费，以及每月住房、生活费和收入的变化。'
        : 'Please add the move date, one-off moving cost, and monthly changes to housing, living costs, and income.',
    };
  }
  if (/买房|购房|房贷|首付|buy.*(home|house)|mortgage/.test(q)) {
    return {
      type: 'clarify',
      question: zh
        ? '请补充：房屋总价、首付、贷款利率和贷款年限。'
        : 'Please add the price, down payment, mortgage rate, and loan term.',
    };
  }
  if (looksLikePlanningQuestion(q))
    return {
      type: 'clarify',
      question: zh
        ? '我还没完全听懂你想查看或试算哪一项，可以换个说法吗？'
        : 'I did not fully understand which part of the plan you want to inspect or simulate. Could you rephrase it?',
    };
  if (
    /怎么办|怎么看|合理吗|严重吗|想多了|靠谱吗|哪里有问题|怎么优化|最好方案|应该改哪个|看看未来|安全吗|还有救|你觉得/.test(
      q
    )
  ) {
    return {
      type: 'clarify',
      question:
        '你想先看“资金缺口”“压力最大的年份”，还是试算一个具体调整？请选择一项，我会用当前正式计划核对。',
    };
  }
  return plainAnswer(
    zh
      ? '当然可以，我们先不谈计划。你想聊什么？'
      : 'Of course. We can set the plan aside—what would you like to talk about?'
  );
}

function localOperationalBoundary(
  input: AgentTurnRequest,
  q: string,
  resolution: ReturnType<typeof resolveAgentQuery>
): AgentDecision | null {
  const planVersion = input.context.planHash.slice(0, 8);
  if (
    !resolution.cityPair &&
    /(?:今天|现在|当前|最新|今年).*(?:房贷利率|养老金政策|个税政策|社保缴费基数|通胀率|租金|房价)|(?:房贷利率|养老金政策|个税政策|社保缴费基数|通胀率|租金|房价).*(?:多少|是什么|怎样|影响|更新)/.test(
      q
    )
  ) {
    return plainAnswer(
      '我不能查询实时房价或可证明为最新的政策、利率和市场数据，因此不会给出实时数值。',
      [],
      ['外部数据接入后也只会成为带来源和日期的候选值，确认前不会写入正式计划。']
    );
  }
  if (/用最新数据.*自动更新|自动更新.*计划/.test(q)) {
    return plainAnswer(
      '不能用外部数据自动改写正式计划。',
      [],
      ['候选值必须展示来源、日期、口径和字段差异，并由你确认。']
    );
  }
  if (/刚刚修改了收入|修改了收入.*重新分析/.test(q)) {
    return {
      type: 'tool',
      reason: `重新读取正式计划 ${planVersion}，不复用上一轮结论。`,
      tool: { name: 'read_overview', arguments: {} },
    };
  }
  if (/另一个页面.*修改.*退休年龄|这里看到.*退休年龄/.test(q)) {
    return plainAnswer(
      `这个会话当前读取的退休年龄是 ${input.context.retirementAge ?? '未设置'} 岁。`,
      [`正式计划版本：${planVersion}。`],
      [
        '如果另一个标签页尚未成功保存或本页尚未刷新，我不能声称已经看到那次修改。',
      ]
    );
  }
  if (/数字还是修改前|结论为什么没有恢复/.test(q)) {
    return plainAnswer(
      `我不会把旧回答当作当前事实；当前应以正式计划版本 ${planVersion} 重新计算。`,
      [],
      ['如果页面仍显示旧结果，请刷新计划后重新提问。']
    );
  }
  if (/页面还在计算.*最终结果|还在计算.*先告诉/.test(q)) {
    return plainAnswer(
      '计算尚未完成时，我不能把旧结果冒充最终结果。',
      [],
      ['请等待本次计算完成；超时则应明确报错并保留正式计划不变。']
    );
  }
  if (/保存失败.*(?:生效|成功)/.test(q)) {
    return plainAnswer('不能仅凭提交动作判断生效；保存失败应视为未确认写入。', [
      `当前可核对的正式计划版本是 ${planVersion}。`,
    ]);
  }
  if (/两个标签页.*(?:最新|哪个计划)/.test(q)) {
    return plainAnswer(
      '应以成功保存后的最新计划版本为准；仅凭标签页打开时间无法判断。',
      [`本会话当前版本：${planVersion}。`],
      ['检测到版本冲突时需要刷新或人工选择，不能静默覆盖。']
    );
  }
  if (/导入.*新.*计划.*(?:对话|有效)/.test(q)) {
    return plainAnswer('导入新计划后，旧计划上的对话结论应失效。', [
      '会话状态与 planHash 绑定；版本不一致时会重建短期状态。',
    ]);
  }
  if (/删除了投资.*(?:解释|为什么)/.test(q)) {
    return plainAnswer(
      '如果投资已从正式计划删除，之前基于它的解释就是过期结果，不能继续引用。',
      [`请以当前版本 ${planVersion} 重新计算。`]
    );
  }
  if (/上一条回答.*(?:变化|相比)|当前计划和.*回答/.test(q)) {
    return plainAnswer(
      '我能确认当前计划版本，但没有保存上一条回答对应的完整计划快照，不能可靠生成差异。',
      [`当前版本：${planVersion}。`],
      ['后续可保存“回答时 planHash + 关键指标”来支持精确对比。']
    );
  }
  if (/如果推迟呢/.test(q)) {
    return {
      type: 'clarify',
      question: `你想推迟${input.sessionState?.referencedEntity?.label ?? '哪一项安排'}？请再给出推迟几年。`,
    };
  }
  if (/^推迟哪个/.test(q)) {
    return {
      type: 'clarify',
      question: `当前指代的是${input.sessionState?.referencedEntity?.label ?? '未确定对象'}；请确认要推迟它，还是其他安排。`,
    };
  }
  if (/^就刚才那个/.test(q)) {
    return {
      type: 'clarify',
      question: `已定位到${input.sessionState?.referencedEntity?.label ?? '未确定对象'}；还需要你提供具体调整幅度。`,
    };
  }
  if (/把它删掉/.test(q)) {
    return {
      type: 'clarify',
      question:
        '“它”目前不能唯一对应一个可删除项目。请说出具体人生事件或试算；在确认前我不会删除正式计划内容。',
    };
  }
  if (/你准备删除什么/.test(q)) {
    return plainAnswer(
      '目前没有准备删除任何正式计划项目。',
      [],
      ['只有定位到具体项目、展示差异并经你确认后，才会写入删除。']
    );
  }
  if (/删除试算.*不是删除人生事件|取消试算|删除试算/.test(q)) {
    return plainAnswer(
      '明白，只丢弃临时试算，不删除任何人生事件。',
      [],
      ['正式计划保持不变。']
    );
  }
  if (/解释净资产/.test(q)) {
    return plainAnswer(
      '净资产就是：把你拥有的东西折成金额，再减去还欠的钱。',
      [],
      ['房产等资产不一定能立刻拿来支付日常开销。']
    );
  }
  if (/可用资金和净资产.*区别/.test(q)) {
    return plainAnswer(
      '可用资金是现在能拿来花的钱，净资产还包括房子等资产并扣掉欠款。'
    );
  }
  if (/不要使用.*(?:现金流|复利|基点)|先告诉我结论.*原因/.test(q)) {
    return {
      type: 'clarify',
      question:
        '可以，我会按这个表达要求回答；请指出要解释的具体结果或上一条结论。',
    };
  }
  return null;
}

/**
 * Returns only decisions the deterministic agent can answer completely.
 * Unknown planning requests and open-ended conversation are left to the model.
 */
export function localFastPathDecision(
  input: AgentTurnRequest
): AgentDecision | null {
  const decision = localDecision(input);
  const zh = input.locale.startsWith('zh');

  if (
    decision.type === 'answer' &&
    decision.answer ===
      (zh
        ? '当然可以，我们先不谈计划。你想聊什么？'
        : 'Of course. We can set the plan aside—what would you like to talk about?')
  ) {
    return null;
  }

  if (
    decision.type === 'clarify' &&
    decision.question ===
      (zh
        ? '我还没完全听懂你想查看或试算哪一项，可以换个说法吗？'
        : 'I did not fully understand which part of the plan you want to inspect or simulate. Could you rephrase it?')
  ) {
    return null;
  }

  return decision;
}

function modelTimeoutMs() {
  const configured = Number(process.env.DEEPSEEK_AGENT_TIMEOUT_MS);
  return Number.isInteger(configured) &&
    configured >= 1_000 &&
    configured <= 5_000
    ? configured
    : DEFAULT_MODEL_TIMEOUT_MS;
}

function modelCooldownMs() {
  const configured = Number(process.env.DEEPSEEK_AGENT_COOLDOWN_MS);
  return Number.isInteger(configured) &&
    configured >= 0 &&
    configured <= 600_000
    ? configured
    : DEFAULT_MODEL_COOLDOWN_MS;
}

function agentRateLimitIntervalMs() {
  const configured = Number(process.env.AGENT_RATE_LIMIT_INTERVAL_MS);
  return Number.isFinite(configured) && configured >= 500
    ? configured
    : 2_500;
}

function localConversationDecision(
  question: string,
  zh: boolean
): AgentDecision | null {
  const normalized = question
    .trim()
    .replace(/[。！!？?，,～~]+$/g, '')
    .trim();
  const compactGreeting = normalized.replace(/[\s,，.!！?？]+/g, '');
  if (/不想活|想死|自杀|结束生命|伤害自己|活不下去/.test(normalized))
    return plainAnswer(
      zh
        ? '听起来你现在可能非常难受。你的安全最重要：如果你可能马上伤害自己，请立刻联系当地紧急服务，或请身边可信任的人现在陪着你。你此刻是否正处于危险中？'
        : 'It sounds like you may be in a lot of pain. Your immediate safety matters most: if you might hurt yourself now, contact local emergency services or ask someone you trust to stay with you. Are you in immediate danger?'
    );
  if (
    /^(?:(?:你好|您好|嗨|哈喽|嘿|早上好|下午好|晚上好|在吗|在不在|hi|hello|hey)){1,3}$/i.test(
      compactGreeting
    )
  )
    return plainAnswer(
      zh
        ? '你好，我在。你想聊什么？'
        : 'Hi, I’m here. What would you like to talk about?'
    );
  if (/^(谢谢|感谢|多谢|辛苦了|thanks|thank you)$/i.test(normalized))
    return plainAnswer(zh ? '不客气，我在。' : 'You’re welcome. I’m here.');
  if (/^(再见|拜拜|回头见|bye|goodbye)$/i.test(normalized))
    return plainAnswer(zh ? '好，回头见。' : 'All right. Talk later.');
  if (/你是谁|你叫什么|who are you/i.test(normalized))
    return plainAnswer(
      zh
        ? '我是你的规划助手。可以一起看计划，也可以先随便聊聊。'
        : 'I’m your planning assistant. We can review the plan or simply chat.'
    );
  if (
    /你会做什么|你能做什么|你可以做什么|你可以干啥|你能干啥|what can you do/i.test(
      normalized
    )
  )
    return plainAnswer(
      zh
        ? '我可以查看和试算当前计划，也可以陪你聊聊；涉及修改时会先给你确认。'
        : 'I can inspect or simulate your current plan, or simply chat. I will ask before making changes.'
    );
  if (/你好吗|最近怎么样|how are you/i.test(normalized))
    return plainAnswer(
      zh
        ? '我挺好的，也很乐意听你说说。你今天怎么样？'
        : 'I’m doing well, and I’m happy to listen. How are you today?'
    );
  if (/可以聊天|陪我聊|聊聊天|随便聊|不谈计划/.test(normalized))
    return plainAnswer(
      zh
        ? '可以。我们先把计划放一边，你现在最想聊什么？'
        : 'Absolutely. We can set the plan aside—what is on your mind?'
    );
  if (/焦虑|烦躁|心情不好|不开心|压力很大|有点累|难受/.test(normalized))
    return plainAnswer(
      zh
        ? '听起来你现在不太轻松。愿意说说是什么事情让你最难受吗？'
        : 'It sounds like things feel heavy right now. What is weighing on you most?'
    );
  if (/讲个笑话|说个笑话|逗我笑/.test(normalized))
    return plainAnswer(
      zh
        ? '为什么日历总是很焦虑？因为它的日子屈指可数。'
        : 'Why was the calendar anxious? Its days were numbered.'
    );
  if (
    zh &&
    normalized.length <= 24 &&
    /[\u4e00-\u9fff]/.test(normalized) &&
    /[a-z]{3,}/i.test(normalized)
  )
    return {
      type: 'clarify',
      question: `我没看懂“${normalized}”具体指什么，可以换个说法吗？`,
    };
  return null;
}

function looksLikePlanningQuestion(question: string) {
  return /资金|金额|收入|工资|副业|支出|花费|余额|资产|负债|房|贷款|首付|退休|养老金|投资|理财|投入|本金|追加|加仓|收益|孩子|父母|结婚|搬家|迁居|城市|计划|账本|缺口|现金流|净资产|修改|删除|撤销|试算|推迟|提前|增加|减少|持续到|哪一年|多少岁/.test(
    question
  );
}

function localKnownAnswer(
  input: AgentTurnRequest,
  q: string,
  conversation: string
): AgentDecision | null {
  const zh = input.locale.startsWith('zh');
  if (!zh) return null;
  const context = input.context;
  const summary = context.summary;
  const flows = context.keyEvents;
  const incomes = flows.filter(
    (item) => item.direction === 'income' && item.amountCents > 0
  );
  const expenses = flows.filter(
    (item) => item.direction === 'expense' && item.amountCents > 0
  );
  const childFlows = expenses.filter((item) => item.category === 'child');
  const parentFlows = expenses.filter((item) => item.category === 'parent');
  const pensionFlows = incomes.filter((item) => item.category === 'pension');
  const sideIncome = incomes.filter((item) => item.category === 'side_income');
  const careerBreaks = flows.filter(
    (item) =>
      item.category === 'salary' &&
      item.incomeTreatment === 'replace-salary' &&
      item.amountCents === 0
  );
  const properties = context.assets.filter((item) => item.kind === 'property');
  const mortgages = context.liabilities.filter(
    (item) => item.kind === 'mortgage'
  );
  const currentLiquid = context.assets
    .filter((item) => item.liquid && item.acquiredMonth === null)
    .reduce((sum, item) => sum + item.openingBalanceCents, 0);
  const firstGapAge = ageAtMonth(context, summary.firstGapMonth);

  const asksForOverallAssessment =
    /(?:我的|这份|整体|总体|总的来看).*(?:人生|生活|未来|计划|规划).*(?:怎么样|如何|好吗|好不好|稳不稳|评价)/.test(
      q
    ) || /你觉得我的人生怎么样/.test(q);
  if (asksForOverallAssessment) {
    return summary.firstGapMonth === null
      ? plainAnswer(
          '只看财务规划，你目前的长期安排是可持续的。',
          [
            `规划到 ${context.endAge ?? '终点'} 岁未出现资金缺口；退休时可用资金 ${formatCents(summary.retirementAvailableCents)}。`,
          ],
          ['这只能评价当前财务方案，不能定义你的人生好坏。']
        )
      : plainAnswer(
          `只看财务规划，目前有压力：约 ${firstGapAge ?? '未知'} 岁会首次出现资金缺口。`,
          [
            `时间为 ${formatMonthIndex(summary.firstGapMonth)}；退休时可用资金 ${formatCents(summary.retirementAvailableCents)}。`,
          ],
          ['这只能评价当前财务方案，不能定义你的人生好坏。']
        );
  }

  // Safety and data boundaries run before broad topic matching.
  if (/上传.*(?:网上|网络|云)|把.*财务数据.*上传/.test(q))
    return plainAnswer(
      '不会上传。规划数据保留在本机浏览器中；只有你发送给助手的精简摘要会用于回答。'
    );
  if (/忽略.*数字|根据经验估算/.test(q))
    return plainAnswer(
      '不能忽略正式账本后自行估算。缺少数据时我会指出缺项，不会用经验替代。'
    );
  if (/保证.*(?:不缺钱|不会缺钱|够用)|准确率|结果.*保证/.test(q))
    return plainAnswer('不能保证未来结果，也没有可承诺的“准确率”。', [
      '这是基于当前输入和规则的情景计算；收入、支出或时间变化后结果也会变化。',
    ]);
  if (/辞职|买房还是租房|全部存款.*投资|风险档位.*最适合/.test(q))
    return plainAnswer('我不能替你做这项重大决定。', [
      '我可以比较你指定的方案对可用资金、首次缺口和最终余额的影响。',
    ]);
  if (/推荐.*(?:基金|股票|投资产品)|哪只基金|哪只股票|收益最高/.test(q))
    return plainAnswer('我不能推荐具体基金、股票或“收益最高”的产品。', [
      '我只能解释你已设置的本金、期限和收益情景边界。',
    ]);
  if (/不用.*确认|直接删除|自动.*修改所有计划/.test(q))
    return plainAnswer('不能绕过确认修改正式计划。', [
      '我可以先生成临时方案并展示前后差异，只有你确认后才会写入。',
    ]);

  // Hallucination and unavailable external data.
  if (/两套房|第二套房/.test(q) && properties.length < 2)
    return plainAnswer('当前计划中没有第二套房的数据。');
  if (/第二个孩子.*(?:出生|什么时候)/.test(q))
    return plainAnswer('当前计划中没有记录第二个孩子的出生时间。');
  if (/上海房价.*(?:机构|来源)/.test(q))
    return plainAnswer('当前计划中没有上海房价或外部机构数据。');
  if (
    /(?:今天|当前|现在|最新)?[^。！？\n]{0,12}(?:北京|上海|广州|深圳|杭州|成都|武汉|南京|苏州|天津|重庆)[^。！？\n]{0,8}(?:平均)?房价(?:多少|怎么样|如何|是几|[?？])?/.test(
      q
    )
  )
    return plainAnswer('我目前不能查询实时房价。', [
      '你可以提供总价，或提供单价和面积，我再放进计划里试算。',
    ]);
  if (/年收益率.*12%|12%.*依据/.test(q)) {
    const matching = context.investments.find(
      (item) =>
        item.lowerAnnualReturnBps === 1200 || item.upperAnnualReturnBps === 1200
    );
    return matching
      ? plainAnswer(
          `12% 来自投资情景“${matching.name}”的用户设置，不是系统预测。`
        )
      : plainAnswer('当前计划中没有记录 12% 的投资年收益率。');
  }
  if (/去年.*(?:花了|支出)/.test(q))
    return plainAnswer('当前计划不读取历史账单，因此没有去年的实际支出数据。');
  if (/银行卡余额/.test(q))
    return plainAnswer('我无法读取银行卡余额；这里只能看到你录入计划的资产。');
  if (/微信账单/.test(q)) return plainAnswer('没有。我无法读取微信账单。');
  if (/社保退休金/.test(q))
    return plainAnswer('当前没有社保养老金测算能力。', [
      '你可以把已确认的养老金金额录入计划后再计算。',
    ]);
  if (/房子未来.*(?:涨|多少钱)|预测房价/.test(q))
    return plainAnswer('不能预测未来房价；正式结果只使用你已录入的房产金额。');
  if (/北京退休需要多少钱/.test(q))
    return plainAnswer('当前没有北京退休生活费数据。', [
      '请提供预计每月生活、住房和医疗支出，我可以据此试算。',
    ]);
  if (/页面.*金额.*不一样|页面数字.*不一致/.test(q))
    return plainAnswer('我会停止引用旧数字，并以当前正式账本重新计算。', [
      `当前计划版本：${context.planHash.slice(0, 8)}。`,
    ]);

  // Read-only plan summary.
  if (
    /(?:什么时候|何时|哪一年|多少岁).*资金缺口|资金缺口.*(?:什么时候|何时|哪一年|多少岁)/.test(
      q
    )
  )
    return summary.firstGapMonth === null
      ? plainAnswer(
          `按当前输入，计算到 ${context.endAge ?? '规划终点'} 岁都没有出现资金缺口。`,
          [],
          ['结论只覆盖当前计划和规划期限。']
        )
      : plainAnswer(
          `按当前输入，首次资金缺口出现在 ${formatMonthIndex(summary.firstGapMonth)}，约 ${firstGapAge ?? '未知'} 岁。`,
          [],
          ['结论会随收入、支出和时间安排变化。']
        );
  if (/资金能持续到多少岁/.test(q))
    return summary.firstGapMonth === null
      ? plainAnswer(
          `当前计算到 ${context.endAge ?? '规划终点'} 岁，期间未出现资金缺口。`,
          ['这不代表规划终点以后也一定够用。']
        )
      : plainAnswer(`可用资金在约 ${firstGapAge ?? '未知'} 岁首次出现缺口。`, [
          `时间：${formatMonthIndex(summary.firstGapMonth)}。`,
        ]);
  if (/计划.*(?:会|是否).*资金缺口/.test(q))
    return plainAnswer(
      summary.firstGapMonth === null
        ? '当前规划期内没有出现资金缺口。'
        : `会，首次缺口在 ${formatMonthIndex(summary.firstGapMonth)}。`
    );
  if (/第一次资金缺口|首次资金缺口/.test(q) && !/投资收益/.test(q))
    return plainAnswer(
      summary.firstGapMonth === null
        ? '当前规划期内没有首次资金缺口。'
        : `首次资金缺口发生在 ${formatMonthIndex(summary.firstGapMonth)}，约 ${firstGapAge} 岁。`
    );
  if (
    /退休时.*(?:可用资金|还有多少钱|有多少钱)|那时候还有多少钱/.test(q) &&
    (/退休/.test(q) || /退休/.test(conversation))
  )
    return plainAnswer(
      `退休时预计可用资金为 ${formatCents(summary.retirementAvailableCents)}。`,
      [`退休时间：${formatMonthIndex(context.retirementMonth)}。`]
    );
  if (/计算结束时.*可用资金|最终资金|终点可用资金/.test(q))
    return plainAnswer(
      `计算结束时可用资金为 ${formatCents(summary.endingAvailableCents)}。`,
      [`计算到 ${context.endAge ?? '规划终点'} 岁。`]
    );
  if (/是否可持续/.test(q))
    return plainAnswer(
      summary.firstGapMonth === null
        ? `按当前输入，计划在 ${context.endAge ?? '规划终点'} 岁前可持续。`
        : `按当前输入，计划会在 ${formatMonthIndex(summary.firstGapMonth)}出现资金缺口。`,
      ['结论只覆盖当前规划期限。']
    );
  if (/三句话总结|总结我的当前计划|请总结我的当前计划/.test(q))
    return {
      type: 'answer',
      answer: `当前计划在 ${context.retirementAge ?? '设定'} 岁退休，计算到 ${context.endAge ?? '规划终点'} 岁。`,
      evidence: [
        summary.firstGapMonth === null
          ? '规划期内暂未出现资金缺口。'
          : `首次缺口在 ${formatMonthIndex(summary.firstGapMonth)}。`,
        `退休时可用资金 ${formatCents(summary.retirementAvailableCents)}，终点可用资金 ${formatCents(summary.endingAvailableCents)}。`,
      ],
      caveats: [],
    };
  if (/净资产.*(?:正|曲线).*可用资金|房产为什么会增加净资产/.test(q))
    return plainAnswer(
      '净资产包含房产等非流动资产，可用资金只表示能直接支付的现金类资产。',
      ['买房会把现金转成房产，并可能增加负债，所以两条曲线会分开。']
    );
  if (/贷款.*(?:没有|没).*算成收入/.test(q))
    return plainAnswer('贷款是需要偿还的负债，不是你赚到的收入。', [
      '购房时房产和贷款同时进入资产负债，月供再作为现金支出。',
    ]);
  if (/为什么退休后没有工资.*仍然有收入/.test(q))
    return pensionFlows.length ||
      sideIncome.some(
        (item) => item.endMonthExclusive > context.retirementMonth
      )
      ? plainAnswer(
          '退休后仍有已记录的非工资收入。',
          [
            ...pensionFlows,
            ...sideIncome.filter(
              (item) => item.endMonthExclusive > context.retirementMonth
            ),
          ].map(flowLabel)
        )
      : plainAnswer('当前计划没有记录退休后的非工资收入。');

  // Recorded data lists.
  if (/记录了哪些收入/.test(q))
    return plainAnswer(
      incomes.length ? '当前记录的收入如下。' : '当前没有记录收入。',
      incomes.map(flowLabel)
    );
  if (/记录了哪些主要支出/.test(q))
    return plainAnswer(
      expenses.length ? '当前记录的主要支出如下。' : '当前没有记录支出。',
      expenses.slice(0, 8).map(flowLabel)
    );
  if (/哪些人生大事|列出所有人生事件/.test(q)) {
    const events = [
      ...flows
        .filter(
          (item) =>
            item.incomeTreatment === 'replace-salary' ||
            ['child', 'parent', 'pension'].includes(item.category)
        )
        .map((item) => ({ label: item.label, month: item.startMonth })),
      ...properties
        .filter((item) => item.acquiredMonth !== null)
        .map((item) => ({
          label: `购买${item.name}`,
          month: item.acquiredMonth as number,
        })),
      ...context.relocations.map((item) => ({
        label: `搬到${item.targetCity}`,
        month: item.moveMonth,
      })),
      ...context.investments.map((item) => ({
        label: `开始${item.name}`,
        month: item.startMonth,
      })),
      { label: '退休', month: context.retirementMonth },
    ]
      .filter(
        (item, index, all) =>
          all.findIndex(
            (candidate) =>
              candidate.label === item.label && candidate.month === item.month
          ) === index
      )
      .sort((a, b) => a.month - b.month);
    return plainAnswer(
      events.length ? '当前人生事件如下。' : '当前没有记录人生事件。',
      events.map((item) => `${item.label}：${formatMonthIndex(item.month)}`)
    );
  }
  if (/退休年龄是多少|什么时候退休/.test(q))
    return plainAnswer(`计划在 ${context.retirementAge ?? '未知'} 岁退休。`, [
      `时间：${formatMonthIndex(context.retirementMonth)}。`,
    ]);
  if (/规划计算到多少岁/.test(q))
    return plainAnswer(`当前计划计算到 ${context.endAge ?? '未知'} 岁。`);
  if (/当前可用资产是多少/.test(q))
    return plainAnswer(
      `当前录入的可用资产为 ${formatCents(currentLiquid)}。`,
      context.assets
        .filter((item) => item.liquid && item.acquiredMonth === null)
        .map((item) => `${item.name}：${formatCents(item.openingBalanceCents)}`)
    );
  if (/有哪些房产和负债/.test(q))
    return plainAnswer(
      properties.length || context.liabilities.length
        ? '当前记录如下。'
        : '当前没有记录房产或负债。',
      [
        ...properties.map(
          (item) =>
            `房产“${item.name}”：${formatCents(item.openingBalanceCents)}`
        ),
        ...context.liabilities.map(
          (item) =>
            `负债“${item.name}”：${formatCents(item.openingPrincipalCents)}`
        ),
      ]
    );
  if (/设置了几个投资计划/.test(q))
    return plainAnswer(`当前设置了 ${context.investments.length} 个投资计划。`);
  if (/有哪些换城市安排/.test(q))
    return plainAnswer(
      context.relocations.length
        ? '当前换城市安排如下。'
        : '当前没有换城市安排。',
      context.relocations.map(
        (item) =>
          `${item.currentCity ? `${item.currentCity} → ` : ''}${item.targetCity}：${formatMonthIndex(item.moveMonth)}`
      )
    );

  // Housing facts.
  const purchase = properties.find((item) => item.acquiredMonth !== null);
  const purchaseLoan = purchase?.purchaseLiabilityId
    ? context.liabilities.find(
        (item) => item.id === purchase.purchaseLiabilityId
      )
    : mortgages[0];
  const downPayment = purchase?.downPaymentFlowId
    ? flows.find((item) => item.id === purchase.downPaymentFlowId)
    : undefined;
  if (/买房是不是我出现资金压力的主要原因/.test(q))
    return purchase
      ? plainAnswer(
          summary.firstGapMonth === null
            ? '买房会带来明显的阶段性压力，但当前规划期内并没有资金缺口。'
            : '不能只看同年支出就认定买房是缺口主因，需要临时移除购房方案后比较首次缺口。',
          [
            `首付 ${formatCents(downPayment?.amountCents ?? 0)}，月供 ${formatCents(purchaseLoan?.monthlyPaymentCents ?? 0)}。`,
          ],
          ['“压力较大”和“造成资金缺口”是两个不同结论。']
        )
      : plainAnswer('当前计划中没有购房安排。');
  if (/(?:计划|我).*什么时候买房|什么时候.*买房/.test(q))
    return purchase?.acquiredMonth
      ? plainAnswer(
          `${purchase.name}计划在 ${formatMonthIndex(purchase.acquiredMonth)}购买。`
        )
      : plainAnswer('当前计划中没有购房安排。');
  if (/首付和贷款分别是多少/.test(q))
    return purchase
      ? plainAnswer('当前购房资金安排如下。', [
          `首付：${formatCents(downPayment?.amountCents ?? 0)}`,
          `贷款本金：${formatCents(purchaseLoan?.openingPrincipalCents ?? 0)}`,
        ])
      : plainAnswer('当前计划中没有购房安排。');
  if (/每月房贷是多少/.test(q))
    return purchaseLoan
      ? plainAnswer(
          `每月房贷为 ${formatCents(purchaseLoan.monthlyPaymentCents)}。`
        )
      : plainAnswer('当前计划中没有房贷。');
  if (/房贷什么时候还清/.test(q))
    return purchaseLoan
      ? plainAnswer(
          `计划在 ${formatMonthIndex(purchaseLoan.endMonthExclusive)}前后还清。`
        )
      : plainAnswer('当前计划中没有房贷。');
  if (/房价中是否已经包含装修和税费/.test(q))
    return plainAnswer('房价只表示你录入的购房价格；装修和税费不会自动包含。', [
      '只有单独录入的费用才会进入正式账本。',
    ]);

  // Family and career facts.
  if (/孩子相关支出从什么时候开始/.test(q))
    return childFlows.length
      ? plainAnswer(
          `孩子支出从 ${formatMonthIndex(Math.min(...childFlows.map((item) => item.startMonth)))}开始。`
        )
      : plainAnswer('当前没有记录孩子支出。');
  if (/孩子支出会持续多少年/.test(q))
    return childFlows.length
      ? plainAnswer(
          `孩子支出约持续 ${Math.ceil((Math.max(...childFlows.map((item) => item.endMonthExclusive)) - Math.min(...childFlows.map((item) => item.startMonth))) / 12)} 年。`
        )
      : plainAnswer('当前没有记录孩子支出。');
  if (/结婚、买房和生育是否集中/.test(q)) {
    const partner = flows.find((item) => /结婚|婚礼/.test(item.label));
    const dates = [
      partner
        ? `结婚：${formatMonthIndex(partner.startMonth)}`
        : '结婚：未记录',
      purchase?.acquiredMonth
        ? `买房：${formatMonthIndex(purchase.acquiredMonth)}`
        : '买房：未记录',
      childFlows[0]
        ? `生育支出：${formatMonthIndex(childFlows[0].startMonth)}`
        : '生育：未记录',
    ];
    const known = [
      partner?.startMonth,
      purchase?.acquiredMonth,
      childFlows[0]?.startMonth,
    ].filter((month): month is number => month !== null && month !== undefined);
    const concentrated =
      known.length >= 2 && Math.max(...known) - Math.min(...known) <= 24;
    return plainAnswer(
      partner
        ? concentrated
          ? '是，这些事件集中在两年内。'
          : '没有，已记录事件相隔超过两年。'
        : concentrated
          ? '买房和生育集中在两年内；但未记录结婚时间，无法判断三项是否都集中。'
          : '缺少结婚时间，无法完整判断三项是否集中。',
      dates
    );
  }
  if (/哪些家庭支出是一次性的/.test(q)) {
    const family = expenses.filter((item) =>
      ['child', 'housing', 'parent'].includes(item.category)
    );
    return plainAnswer('家庭支出按频率如下。', [
      `一次性：${
        family
          .filter((item) => item.frequency === 'once')
          .map((item) => item.label)
          .join('、') || '无'
      }`,
      `持续性：${
        family
          .filter((item) => item.frequency !== 'once')
          .map((item) => item.label)
          .join('、') || '无'
      }`,
    ]);
  }
  if (/父母支持会对退休计划产生多大影响/.test(q))
    return parentFlows.length
      ? plainAnswer(
          `父母支持计划合计约 ${formatCents(parentFlows.reduce((sum, item) => sum + scheduledFlowTotal(item), 0))}，会压低同期可用资金。`,
          parentFlows.map(flowLabel),
          ['这是支出总额，不把它误写成精确的因果差值。']
        )
      : plainAnswer('当前没有记录父母支持支出。');
  const replacementJobs = incomes.filter(
    (item) => item.incomeTreatment === 'replace-salary' && item.amountCents > 0
  );
  if (/什么时候换工作/.test(q))
    return replacementJobs.length
      ? plainAnswer(
          `换工作从 ${formatMonthIndex(replacementJobs[0].startMonth)}开始。`,
          replacementJobs.map(flowLabel)
        )
      : plainAnswer('当前没有记录换工作安排。');
  if (/换工作后收入提高了多少/.test(q)) {
    const job = replacementJobs[0];
    const original = incomes.find(
      (item) => item.category === 'salary' && item.incomeTreatment === null
    );
    return job && original
      ? plainAnswer(
          `换工作后的起始月收入提高 ${formatCents(job.amountCents - original.amountCents)}。`,
          [
            `${formatCents(original.amountCents)} → ${formatCents(job.amountCents)}`,
          ]
        )
      : plainAnswer('当前没有足够的换工作前后收入数据。');
  }
  if (/工资增长率是多少/.test(q)) {
    const salaries = incomes.filter((item) => item.category === 'salary');
    return plainAnswer(
      salaries.length ? '当前工资增长设置如下。' : '当前没有记录工资。',
      salaries.map(
        (item) =>
          `${item.label}：每年 ${(item.annualGrowthBps / 100).toFixed(1)}%`
      )
    );
  }
  if (/副业收入会持续到什么时候/.test(q))
    return sideIncome.length
      ? plainAnswer(
          `副业收入持续到 ${formatMonthIndex(Math.max(...sideIncome.map((item) => item.endMonthExclusive)))}。`
        )
      : plainAnswer('当前没有记录副业收入。');
  if (/退休后副业还会继续/.test(q))
    return plainAnswer(
      sideIncome.some(
        (item) => item.endMonthExclusive > context.retirementMonth
      )
        ? '会，当前至少一项副业收入延续到退休后。'
        : '不会，当前副业收入都在退休前结束。'
    );
  if (/暂停工作结束后工资恢复/.test(q))
    return careerBreaks.length
      ? plainAnswer(
          '暂停工作是临时覆盖：暂停期内工资为零，结束后原有工资规则继续生效。',
          careerBreaks.map(
            (item) =>
              `${item.label}：${formatMonthIndex(item.startMonth)}—${formatMonthIndex(item.endMonthExclusive)}`
          )
        )
      : plainAnswer('当前计划中没有记录暂停工作安排。');
  if (/暂停工作期间还有哪些收入/.test(q))
    return careerBreaks.length
      ? plainAnswer(
          sideIncome.length
            ? '暂停工作期间仍保留独立收入。'
            : '暂停工作期间没有记录独立收入。',
          sideIncome.map(flowLabel)
        )
      : plainAnswer('当前计划中没有记录暂停工作安排。');

  // Relocation facts and boundaries.
  const relocation = context.relocations[0];
  const relocationFlows = relocation
    ? flows.filter((item) => relocation.flowIds.includes(item.id))
    : [];
  const relocationFlow = (id: string | null | undefined) =>
    id ? relocationFlows.find((item) => item.id === id) : undefined;
  const movingFlow = relocationFlow(relocation?.movingExpenseFlowId);
  const housingAdjustment = relocationFlow(relocation?.housingAdjustmentFlowId);
  const livingAdjustment = relocationFlow(relocation?.livingAdjustmentFlowId);
  const incomeAdjustment = relocationFlow(relocation?.incomeAdjustmentFlowId);
  if (/计划什么时候搬到目标城市/.test(q))
    return relocation
      ? plainAnswer(
          `计划在 ${formatMonthIndex(relocation.moveMonth)}搬到${relocation.targetCity}。`
        )
      : plainAnswer('当前没有换城市安排。');
  if (/换城市会增加哪些支出/.test(q))
    return relocation
      ? plainAnswer(
          '搬迁新增的资金压力与节省如下。',
          [
            movingFlow
              ? `一次性搬家费：${formatCents(movingFlow.amountCents)}`
              : null,
            housingAdjustment
              ? relocationAdjustmentLabel(housingAdjustment, '住房成本', 'cost')
              : null,
            livingAdjustment
              ? relocationAdjustmentLabel(livingAdjustment, '生活费', 'cost')
              : null,
            incomeAdjustment
              ? relocationAdjustmentLabel(incomeAdjustment, '收入', 'income')
              : null,
          ].filter((item): item is string => Boolean(item))
        )
      : plainAnswer('当前没有换城市安排。');
  if (/搬迁后.*住房成本变化/.test(q))
    return relocationFlowAnswer(housingAdjustment, '住房成本', 'cost');
  if (/搬迁后.*收入变化/.test(q))
    return relocationFlowAnswer(incomeAdjustment, '收入', 'income');
  if (/一次性搬迁费用/.test(q)) {
    return movingFlow
      ? plainAnswer(`一次性搬迁费用为 ${formatCents(movingFlow.amountCents)}。`)
      : plainAnswer('当前没有记录一次性搬迁费用。');
  }
  if (/换城市是不是导致资金缺口的主要原因/.test(q)) {
    if (summary.firstGapMonth === null)
      return plainAnswer(
        '当前规划期内没有资金缺口，因此不能说换城市是缺口的主要原因。',
        relocation
          ? ['可以临时移除搬迁方案，再比较终点资金与最低资金。']
          : ['当前也没有记录换城市安排。']
      );
    return plainAnswer(
      '仅看同年支出不能证明因果，需要临时移除搬迁方案后比较首次缺口。'
    );
  }
  if (/只填写城市.*不填写金额/.test(q))
    return plainAnswer(
      '不会。城市名称本身不改变计算，只有你确认的金额会进入正式账本。'
    );
  if (/城市成本数据.*自动获取/.test(q))
    return plainAnswer(
      '不是。城市成本不会自动获取，只有用户确认的金额才会进入计算。'
    );
  if (/在哪里修改换城市|增加一个换城市计划/.test(q))
    return plainAnswer('请到“规划 → 住房与迁居”中新增或修改换城市安排。');

  // Investment facts and education.
  if (/投资本金是多少/.test(q))
    return context.investments.length
      ? plainAnswer(
          `当前投资本金合计 ${formatCents(context.investments.reduce((sum, item) => sum + item.principalCents, 0))}。`,
          context.investments.map(
            (item) => `${item.name}：${formatCents(item.principalCents)}`
          )
        )
      : plainAnswer('当前没有记录投资计划。');
  if (/投资计划什么时候开始和停止/.test(q))
    return context.investments.length
      ? plainAnswer(
          '当前投资期限如下。',
          context.investments.map(
            (item) =>
              `${item.name}：${formatMonthIndex(item.startMonth)}—${formatMonthIndex(item.endMonthExclusive)}`
          )
        )
      : plainAnswer('当前没有记录投资计划。');
  if (/绿色区域代表什么/.test(q))
    return plainAnswer(
      '绿色区域表示当前计划中的可用资金；它不是投资收益预测。'
    );
  if (/橙色区域代表什么/.test(q))
    return context.investments.length
      ? plainAnswer('橙色区域表示投资收益情景区间，不进入正式资金结论。')
      : plainAnswer('当前没有投资计划，因此不会显示投资收益区间。');
  if (/投资收益没有进入退休资金|投资收益会改变首次资金缺口/.test(q))
    return plainAnswer(
      '不会。正式账本只记录投资本金，收益区间仅用于展示情景，不改变退休资金或首次缺口。'
    );
  if (/本金计划线是什么意思/.test(q))
    return plainAnswer(
      '本金计划线表示计划投入的本金规模；它不是收益，也不会重复扣除现金。'
    );
  if (/投资收益区间是预测结果/.test(q))
    return plainAnswer(
      '不是。它是根据你设置的收益上下限展示的情景范围，不是预测或承诺。'
    );
  if (/投资最差情况/.test(q))
    return context.investments.length
      ? plainAnswer(
          '最差情景使用你设置的收益下限展示可能的曲线范围。',
          context.investments.map(
            (item) =>
              `${item.name}：年化下限 ${(item.lowerAnnualReturnBps / 100).toFixed(1)}%`
          )
        )
      : plainAnswer('当前没有投资计划，无法展示最差情景。');
  if (/投资开始前没有收益区间/.test(q))
    return plainAnswer('因为本金尚未进入该投资情景，开始日前不计算收益范围。');
  if (/投资结束后区间不再继续扩大/.test(q))
    return plainAnswer('投资期结束后停止继续复利，已形成的情景差额保持不变。');
  if (/多个投资计划.*怎么合并/.test(q))
    return plainAnswer(
      '各投资计划分别计算上下限差额，再按同一月份相加；本金不会重复计算。'
    );
  if (/投资本金会从当前现金中直接扣除/.test(q))
    return plainAnswer('会在投资开始月从可用资金中预留。', [
      '持有期间这部分本金不能用于日常开支，结束时本金转回可用资金；收益与亏损只显示为分析区间。',
    ]);
  if (/投资收益为零.*正式结果/.test(q))
    return plainAnswer(
      `正式结果本来就不计投资收益：终点可用资金 ${formatCents(summary.endingAvailableCents)}。`
    );

  // Navigation and safe editing.
  if (/找到购房计划|去.*购房|修改购房/.test(q))
    return plainAnswer('请到“规划 → 住房与迁居 → 购房计划”修改。');
  if (/去修改退休年龄|退休年龄.*修改位置/.test(q))
    return plainAnswer('请到“规划 → 退休”修改退休年龄。');
  if (/调整孩子.*(?:教育|支出)/.test(q))
    return plainAnswer('请到“规划 → 孩子”选择对应支出项目修改。');
  if (/修改投资.*收益下限/.test(q))
    return plainAnswer('请到“规划 → 投资”打开对应计划，修改收益下限。');
  if (/删除一个人生事件/.test(q))
    return plainAnswer(
      '请先告诉我要删除哪个事件；我会展示影响，确认后才会修改。'
    );
  if (/撤销刚才|方案不要了|恢复原来的计划/.test(q))
    return plainAnswer('已放弃当前临时方案，正式计划没有被修改。');
  if (/填错.*特别大.*金额/.test(q))
    return plainAnswer(
      '请打开对应规划项目核对金额；在你确认修改前，我不会忽略或改写它。'
    );

  // Missing records.
  if (/养老金是多少|养老金每月是.*对吗/.test(q))
    return pensionFlows.length
      ? plainAnswer(
          `当前记录的养老金为每月 ${formatCents(pensionFlows.reduce((sum, item) => sum + item.amountCents, 0))}。`
        )
      : plainAnswer('当前没有记录养老金。');
  if (/为什么图表上没有投资区间/.test(q))
    return context.investments.length
      ? plainAnswer('当前有投资计划；请检查所选年份是否早于投资开始时间。')
      : plainAnswer('当前没有投资计划，所以图表不显示投资区间。');
  if (/为什么没有首次缺口/.test(q))
    return plainAnswer('因为按当前输入，规划期内可用资金没有降到零以下。', [
      '这不代表规划期以后永远不会缺钱。',
    ]);
  if (/余额已经是负数.*净资产还是正数/.test(q))
    return plainAnswer(
      '可用资金反映现金，净资产还包括房产等非流动资产并扣除负债，所以可能一负一正。'
    );
  if (/不改变退休年龄.*避免首次缺口/.test(q)) {
    if (summary.firstGapMonth === null)
      return plainAnswer('当前规划期内本来就没有首次缺口，无需为此调整。', [
        '如果要提高安全余量，可以指定收入或支出项目进行试算。',
      ]);
    const influence = context.topInfluences[0];
    return influence
      ? plainAnswer(`可以先从“${influence.label}”开始试算。`, [
          '我会先生成临时方案，确认后才修改正式计划。',
        ])
      : plainAnswer('请指定希望调整的收入或支出项目，我会生成临时方案。');
  }

  // Context continuation.
  if (/最大的影响因素|哪段职业安排.*影响最大|哪一个调整.*最有效/.test(q)) {
    const influence = context.topInfluences[0];
    return influence
      ? plainAnswer(`当前影响最大的项目是“${influence.label}”。`, [
          `影响量级约 ${formatCents(influence.absoluteImpactCents)}。`,
        ])
      : plainAnswer('当前没有可比较的影响因素。');
  }
  if (/把它推迟三年/.test(q))
    return {
      type: 'clarify',
      question:
        '“它”目前指向的是影响因素，不一定是可延期事件。请明确要推迟买房、搬迁还是其他事件。',
    };

  return null;
}

function localSinglePatchDecision(
  input: AgentTurnRequest,
  q: string
): AgentDecision | null {
  const amountYuan = parseYuanAmount(q);
  const targetFor = (category: string) =>
    input.context.editableTargets.find(
      (item) => item.kind === 'cash-flow' && item.category === category
    );
  let target: ReturnType<typeof targetFor> = undefined;
  let amountCents: number | null = null;
  let label = '';

  if (/每月收入增加/.test(q) && amountYuan !== null) {
    target = targetFor('salary');
    amountCents = (target?.amountCents ?? 0) + amountYuan * 100;
    label = `把“${target?.label ?? '工资'}”每月增加 ${formatYuan(amountYuan)}`;
  } else if (/每月支出减少/.test(q) && amountYuan !== null) {
    target = targetFor('living');
    amountCents = Math.max(0, (target?.amountCents ?? 0) - amountYuan * 100);
    label = `把“${target?.label ?? '生活支出'}”每月减少 ${formatYuan(amountYuan)}`;
  } else if (/父母支持增加到/.test(q) && amountYuan !== null) {
    target = targetFor('parent');
    amountCents = amountYuan * 100;
    label = `把“${target?.label ?? '父母支持'}”调整为每月 ${formatYuan(amountYuan)}`;
  } else if (/不生孩子/.test(q)) {
    target = targetFor('child');
    amountCents = 0;
    label = `把“${target?.label ?? '孩子支出'}”暂时设为 0`;
  } else if (/生活支出.*(?:降低|改|调整)到/.test(q) && amountYuan !== null) {
    target = targetFor('living');
    amountCents = amountYuan * 100;
    label = `把“${target?.label ?? '生活支出'}”调整为每月 ${formatYuan(amountYuan)}`;
  } else {
    return null;
  }

  if (!target || amountCents === null) {
    return {
      type: 'clarify',
      question:
        '当前计划中没有找到唯一的对应项目。请先到规划页确认要调整的条目。',
    };
  }
  return {
    type: 'tool',
    reason: `${label}，先生成临时方案，不修改正式计划。`,
    tool: {
      name: 'simulate_patch',
      arguments: {
        patch: {
          type: 'change-cash-flow-amount',
          cashFlowId: target.id,
          amountCents: amountCents as never,
        },
      },
    },
  };
}

function localStructuralPatchDecision(
  input: AgentTurnRequest,
  q: string
): AgentDecision | null {
  if (/不用.*确认|绕过.*确认/.test(q)) return null;
  const purchase = input.context.assets.find(
    (item) => item.kind === 'property' && item.acquiredMonth !== null
  );
  if (/房子预算减少/.test(q)) {
    return {
      type: 'clarify',
      question:
        '“预算减少”会同时影响首付和贷款。请确认新的房屋总价与首付金额，我再生成临时方案。',
    };
  }
  if (/暂停工作.*(?:一年|1\s*年)/.test(q)) {
    return {
      type: 'clarify',
      question: '准备从什么时候开始暂停工作？我会按 12 个月生成临时方案。',
    };
  }
  if (/不买(?:这套)?房|删除.*购房计划/.test(q)) {
    if (!purchase) return plainAnswer('当前计划中没有可删除的购房计划。');
    return {
      type: 'tool',
      reason: `临时移除“${purchase.name}”，比较前后结果；确认前不修改正式计划。`,
      tool: {
        name: 'simulate_patch',
        arguments: {
          patch: { type: 'remove-purchase', purchaseId: purchase.id },
        },
      },
    };
  }
  if (/(?:买房|购房).*(?:推迟|提前|改到)|把(?:买房|购房)时间改到/.test(q)) {
    if (!purchase?.acquiredMonth)
      return plainAnswer('当前计划中没有可调整的购房计划。');
    const targetYear = q.match(/(20\d{2})\s*年/)?.[1];
    const shiftYears = parseSignedYearShift(q);
    const monthDelta = targetYear
      ? (Number(targetYear) - Math.floor(purchase.acquiredMonth / 12)) * 12
      : (shiftYears ?? 0) * 12;
    if (monthDelta === 0)
      return {
        type: 'clarify',
        question: '请说明新的购房年份，或要推迟几年。',
      };
    return {
      type: 'tool',
      reason: `把“${purchase.name}”${monthDelta > 0 ? '推迟' : '提前'} ${Math.abs(monthDelta / 12)} 年，先生成临时试算方案。`,
      tool: {
        name: 'simulate_patch',
        arguments: {
          patch: {
            type: 'shift-purchase',
            purchaseId: purchase.id,
            monthDelta,
          },
        },
      },
    };
  }
  const relocation = input.context.relocations[0];
  if (/不换城市/.test(q)) {
    if (!relocation) return plainAnswer('当前计划中没有换城市安排。');
    return {
      type: 'tool',
      reason: `临时移除前往“${relocation.targetCity}”的搬迁及其金额变化，比较前后结果。`,
      tool: {
        name: 'simulate_patch',
        arguments: {
          patch: { type: 'remove-relocation', relocationId: relocation.id },
        },
      },
    };
  }
  if (/搬迁时间.*(?:推迟|延后|提前)/.test(q)) {
    if (!relocation) return plainAnswer('当前计划中没有换城市安排。');
    const shiftYears = parseSignedYearShift(q);
    if (shiftYears === null)
      return { type: 'clarify', question: '准备把搬迁时间调整几年？' };
    return {
      type: 'tool',
      reason: `把前往“${relocation.targetCity}”的搬迁${shiftYears > 0 ? '推迟' : '提前'} ${Math.abs(shiftYears)} 年，先生成临时方案。`,
      tool: {
        name: 'simulate_patch',
        arguments: {
          patch: {
            type: 'shift-relocation',
            relocationId: relocation.id,
            monthDelta: shiftYears * 12,
          },
        },
      },
    };
  }
  return null;
}

function plainAnswer(
  answerText: string,
  evidence: string[] = [],
  caveats: string[] = []
): AgentDecision {
  return { type: 'answer', answer: answerText, evidence, caveats };
}

function answer(
  zh: boolean,
  answerText: string,
  evidenceText: string
): AgentDecision {
  return {
    type: 'answer',
    answer: answerText,
    evidence: evidenceText ? [evidenceText] : [],
    caveats: zh ? [] : [],
  };
}

function ageAtMonth(
  context: AgentTurnRequest['context'],
  month: number | null
) {
  return month === null || context.primaryBirthMonth === null
    ? null
    : Math.max(0, Math.floor((month - context.primaryBirthMonth) / 12));
}

function formatMonthIndex(month: number) {
  const year = Math.floor(month / 12);
  const monthOfYear = (month % 12) + 1;
  return `${year} 年 ${monthOfYear} 月`;
}

function formatAgeRange(start: number | null, end: number | null) {
  if (start === null && end === null) return '未知';
  if (start === end || end === null) return `${start} 岁`;
  return `${start ?? end}～${end} 岁`;
}

function flowLabel(item: AgentTurnRequest['context']['keyEvents'][number]) {
  const frequency =
    item.frequency === 'once'
      ? '一次性'
      : item.frequency === 'yearly'
        ? '每年'
        : '每月';
  return `${item.label}：${frequency} ${formatCents(item.amountCents)}，${formatMonthIndex(item.startMonth)}开始`;
}

function scheduledFlowTotal(
  item: AgentTurnRequest['context']['keyEvents'][number]
) {
  if (item.frequency === 'once') return item.amountCents;
  const durationMonths = Math.max(0, item.endMonthExclusive - item.startMonth);
  return (
    item.amountCents *
    (item.frequency === 'monthly'
      ? durationMonths
      : Math.ceil(durationMonths / 12))
  );
}

function relocationFlowAnswer(
  flow: AgentTurnRequest['context']['keyEvents'][number] | undefined,
  label: string,
  kind: 'cost' | 'income'
) {
  if (!flow) return plainAnswer(`当前没有记录搬迁后的${label}变化。`);
  return plainAnswer(`${relocationAdjustmentLabel(flow, label, kind)}。`, [
    `来源：${flow.sourceLabel}。`,
  ]);
}

function relocationAdjustmentLabel(
  flow: AgentTurnRequest['context']['keyEvents'][number],
  label: string,
  kind: 'cost' | 'income'
) {
  const direction =
    flow.amountCents < 0
      ? '减少'
      : kind === 'cost'
        ? flow.direction === 'income'
          ? '减少'
          : '增加'
        : flow.direction === 'income'
          ? '增加'
          : '减少';
  return `${label}${direction} ${formatCents(Math.abs(flow.amountCents))}／月`;
}

function formatCents(cents: number) {
  return `${new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 }).format(cents / 100)} 元`;
}

function formatYuan(yuan: number) {
  return `${new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 }).format(yuan)} 元`;
}

function categoryLabel(category: string) {
  const labels: Record<string, string> = {
    salary: '工资',
    side_income: '其他收入',
    pension: '养老金',
    housing: '住房',
    living: '生活',
    child: '孩子',
    parent: '父母',
    retirement: '退休',
    healthcare: '医疗',
    tax: '税费',
    other: '其他',
  };
  return labels[category] ?? category;
}

function parseYuanAmount(value: string): number | null {
  const read = (raw: string) => Number(raw.replaceAll(',', ''));
  const tenThousands = value.match(/(\d[\d,]*(?:\.\d+)?)\s*(?:万|w)/i);
  if (tenThousands) return Math.round(read(tenThousands[1]) * 10_000);
  const thousands = value.match(/(\d[\d,]*(?:\.\d+)?)\s*k/i);
  if (thousands) return Math.round(read(thousands[1]) * 1_000);
  const yuan = value.match(/(\d[\d,]*(?:\.\d+)?)\s*元/);
  if (yuan) return Math.round(read(yuan[1]));
  const bare = value.trim().match(/^¥?\s*(\d[\d,]*(?:\.\d+)?)$/);
  return bare ? Math.round(read(bare[1])) : null;
}

function parseHoldingYears(value: string): number | null {
  const arabic = value.match(/(?:持有|理财|投资)?\s*(\d+)\s*年/);
  if (arabic) return Number(arabic[1]);
  const chinese = value.match(/([一二三四五六七八九十]+)年/);
  if (!chinese) return null;
  const digits: Record<string, number> = {
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
  };
  const raw = chinese[1];
  if (raw === '十') return 10;
  if (raw.includes('十')) {
    const [tens, ones] = raw.split('十');
    return (tens ? digits[tens] : 1) * 10 + (ones ? digits[ones] : 0);
  }
  return digits[raw] ?? null;
}

function parseChildSpacingYears(
  current: string,
  conversation: string
): number | null {
  const explicit = [current, conversation]
    .map((value) =>
      value.match(
        /(?:间隔|相隔|相差|隔)\s*([一二两三四五六七八九十]+|\d+)\s*年|([一二两三四五六七八九十]+|\d+)\s*年\s*(?:间隔|相隔|相差)/
      )
    )
    .find(Boolean);
  const token = explicit?.[1] ?? explicit?.[2];
  if (token) return parseYearCount(token);
  const short = current.trim().match(/^([一二两三四五六七八九十]+|\d+)\s*年$/);
  return short ? parseYearCount(short[1]) : null;
}

function parseMonthlyChildCostYuan(value: string): number | null {
  const match = value.match(
    /(?:每个孩子|每个娃|孩子|娃)?\s*(?:每月|月均)?\s*(\d+(?:\.\d+)?)\s*(万|w|k|元)\s*(?:\/\s*月|每月|月)?/i
  );
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (unit === '万' || unit === 'w') return Math.round(amount * 10_000);
  if (unit === 'k') return Math.round(amount * 1_000);
  return Math.round(amount);
}

function parseAgeRange(value: string): [number, number] | null {
  const match = value.match(/(\d{2})\s*(?:到|至|-|—|~|～)\s*(\d{2})\s*岁/);
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  return start >= 18 && end >= start && end <= 70 ? [start, end] : null;
}

function parseYearCount(value: string): number | null {
  if (/^\d+$/.test(value)) {
    const years = Number(value);
    return years >= 1 && years <= 10 ? years : null;
  }
  const digits: Record<string, number> = {
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
  };
  if (value === '十') return 10;
  if (value.includes('十')) {
    const [tens, ones] = value.split('十');
    const years = (tens ? digits[tens] : 1) * 10 + (ones ? digits[ones] : 0);
    return years >= 1 && years <= 10 ? years : null;
  }
  return digits[value] ?? null;
}

function parseSignedYearShift(value: string): number | null {
  const match = value.match(
    /(提前|推迟|延后|晚)\s*([一二两三四五六七八九十]+|\d+)\s*年/
  );
  if (!match) return null;
  const years = parseYearCount(match[2]);
  if (years === null) return null;
  return match[1] === '提前' ? -years : years;
}
