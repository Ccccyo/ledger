import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { POST } from '../../../../app/api/life-ledger/assistant/route';
import { calculateMonthlyLifePlan } from '../../calculation';
import { addMonths, createQuickLifePlan } from '../../domain';
import { saveInvestmentScenario } from '../plan/investment-mutations';
import { buildAgentContext, runReadOnlyAgentTool } from './agent-context';
import { parseModelPerception, perceiveTurnLocally } from './agent-perception';
import { buildPlanForDecision, planPerceivedTurn } from './agent-planner';
import type {
  AgentPerception,
  AgentPlan,
  AgentTurnRequest,
} from './agent-types';
import { validatePlannedTurn } from './agent-validation';
import { updateWorkingMemory } from './working-memory';

let plan = createQuickLifePlan({
  currentAge: 32,
  retirementAge: 60,
  endAge: 90,
  monthlyIncomeYuan: 30_000,
  monthlyWorkingExpensesYuan: 12_000,
  currentSavingsYuan: 1_200_000,
});
plan = saveInvestmentScenario(plan, {
  id: 'architecture-investment',
  name: '长期投资',
  principalYuan: 200_000,
  riskLevel: 'high',
  lowerAnnualPercent: -25,
  upperAnnualPercent: 30,
  startMonth: addMonths(plan.baseMonth, 36),
  endMonthExclusive: addMonths(plan.baseMonth, 72),
});
const result = calculateMonthlyLifePlan(plan);
const context = buildAgentContext(result);

function request(question: string): AgentTurnRequest {
  return {
    question,
    locale: 'zh-CN',
    context,
    history: [],
    observations: [],
    sessionState: {
      version: '1.0.0',
      planHash: context.planHash,
      activeIntent: null,
      referencedEntity: null,
      referencedYear: null,
      pendingCityCandidate: null,
      lastToolFingerprints: [],
      workingMemory: null,
      updatedAt: '2026-10-23T00:00:00.000Z',
    },
    step: 0,
    expressionMode: 'strict',
  };
}

describe('Layered Agent architecture', () => {
  it('recognizes a single-city relocation and asks only for missing context', () => {
    for (const [question, targetCity] of [
      ['我想去北京如何', '北京'],
      ['现在的计划去北京如何', '北京'],
      ['如果搬到南京怎么样', '南京'],
    ] as const) {
      const input = request(question);
      const perception = perceiveTurnLocally(input);
      assert.equal(perception.intent, 'relocation_simulation');
      assert.deepEqual(perception.entities.cities, [targetCity]);
      assert.deepEqual(perception.missingFields, ['fromCity', 'moveTiming']);
      const planned = planPerceivedTurn(input, perception);
      assert.equal(planned?.decision.type, 'clarify');
      if (planned?.decision.type === 'clarify') {
        assert.match(
          planned.decision.question,
          new RegExp(`迁居 ${targetCity}`)
        );
        assert.match(planned.decision.question, /哪座城市.*什么时候/);
        assert.doesNotMatch(planned.decision.question, /先不谈计划/);
      }
    }
  });

  it('uses working memory when the user supplies a relocation origin', () => {
    const firstInput = request('我想去北京如何');
    const firstPerception = perceiveTurnLocally(firstInput);
    const firstPlan = planPerceivedTurn(firstInput, firstPerception)!.plan;
    const workingMemory = updateWorkingMemory(
      null,
      context.planHash,
      firstPerception,
      firstPlan,
      '2026-10-23T00:00:00.000Z'
    );
    const followUp = {
      ...request('从上海，明年'),
      sessionState: {
        ...request('从上海，明年').sessionState!,
        workingMemory,
      },
    };
    const perception = perceiveTurnLocally(followUp);
    assert.equal(perception.intent, 'relocation_simulation');
    assert.deepEqual(perception.entities.cities, ['上海', '北京']);
    assert.equal(
      planPerceivedTurn(followUp, perception)?.decision.type,
      'tool'
    );
  });

  it('answers system architecture and intent-recognition questions from facts', () => {
    for (const question of [
      '你的架构是什么',
      '现在的意图识别怎么做的，为啥什么都不明白',
    ]) {
      const input = request(question);
      const perception = perceiveTurnLocally(input);
      assert.equal(perception.intent, 'system_explanation');
      const planned = planPerceivedTurn(input, perception);
      assert.equal(planned?.decision.type, 'answer');
      if (planned?.decision.type === 'answer') {
        assert.match(planned.decision.answer, /单 Agent|意图识别/);
        assert.doesNotMatch(planned.decision.answer, /先不谈计划/);
      }
    }
  });

  it('uses a domain clarification instead of the generic chat fallback', () => {
    const input = request('蓝色怎么样');
    const perception = perceiveTurnLocally(input);
    const planned = planPerceivedTurn(input, perception);
    assert.equal(perception.intent, 'unknown');
    assert.equal(planned?.decision.type, 'clarify');
    if (planned?.decision.type === 'clarify') {
      assert.match(planned.decision.question, /账本|投资|退休|迁居/);
      assert.doesNotMatch(planned.decision.question, /先不谈计划/);
    }
  });

  it('recognizes a city choice and asks for decision criteria', () => {
    const input = request('我应该在上海还是北京');
    const perception = perceiveTurnLocally(input);
    assert.equal(perception.intent, 'city_choice');
    assert.deepEqual(perception.entities.cities, ['上海', '北京']);
    const planned = planPerceivedTurn(input, perception);
    assert.equal(planned?.decision.type, 'clarify');
    if (planned?.decision.type === 'clarify') {
      assert.match(planned.decision.question, /财务影响|工作机会|家庭支持/);
      assert.doesNotMatch(planned.decision.question, /先不谈计划/);
    }
  });

  it('separates an investment explanation from principal collection', () => {
    const input = request('投资本金会怎样影响可用资金？');
    const perception = perceiveTurnLocally(input);
    assert.equal(perception.intent, 'plan_explanation');
    const planned = planPerceivedTurn(input, perception);
    assert.equal(planned?.decision.type, 'answer');
    if (planned?.decision.type === 'answer') {
      assert.match(planned.decision.answer, /减少可用资金/);
      assert.doesNotMatch(planned.decision.answer, /计划投入多少本金/);
    }
  });

  it('uses the existing investment period to calculate capacity', () => {
    const input = request('你觉得我可以再投入多少本金');
    const perception = perceiveTurnLocally(input);
    const planned = planPerceivedTurn(input, perception);
    assert.equal(perception.intent, 'investment_capacity');
    assert.equal(planned?.decision.type, 'tool');
    if (planned?.decision.type !== 'tool') return;
    assert.equal(planned.decision.tool.name, 'get_investment_capacity');
    const observation = runReadOnlyAgentTool(result, planned.decision.tool);
    const followUp = planPerceivedTurn(
      { ...input, observations: [observation], step: 1 },
      perception
    );
    assert.equal(
      followUp,
      null,
      'Observation answer is delegated to coordinator'
    );
  });

  it('treats a complaint as feedback recovery instead of generic chat', () => {
    const input = request('你好笨，完全没回答我的问题');
    const perception = perceiveTurnLocally(input);
    assert.equal(perception.intent, 'feedback');
    const planned = planPerceivedTurn(input, perception);
    assert.equal(planned?.decision.type, 'clarify');
    if (planned?.decision.type === 'clarify') {
      assert.match(planned.decision.question, /理解错了目标|漏用了计划数据/);
    }
  });

  it('parses only schema-valid model perception', () => {
    assert.equal(parseModelPerception({ intent: 'invented' }), null);
    const parsed = parseModelPerception({
      intent: 'city_choice',
      confidence: 'medium',
      goal: '比较上海和北京',
      entities: {
        cities: ['上海', '北京'],
        years: [],
        ages: [],
        amountsCents: [],
        durationsYears: [],
      },
      constraints: [],
      missingFields: ['decisionCriteria'],
      ambiguities: ['没有选择标准'],
      suggestedSkillId: 'relocation-planning',
    });
    assert.equal(parsed?.source, 'model');
    assert.equal(parsed?.intent, 'city_choice');
  });

  it('uses an LLM function call for low-confidence perception by default', async () => {
    const originalFetch = globalThis.fetch;
    const previousKey = process.env.DEEPSEEK_API_KEY;
    process.env.DEEPSEEK_API_KEY = 'test-key';
    let sentBody: Record<string, unknown> | null = null;
    globalThis.fetch = (async (_url, init) => {
      sentBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: null,
                tool_calls: [
                  {
                    type: 'function',
                    function: {
                      name: 'report_agent_perception',
                      arguments: JSON.stringify({
                        intent: 'city_choice',
                        confidence: 'high',
                        goal: '在上海和北京之间选择',
                        entities: {
                          cities: ['上海', '北京'],
                          years: [],
                          ages: [],
                          amountsCents: [],
                          durationsYears: [],
                        },
                        constraints: [],
                        missingFields: ['decisionCriteria'],
                        ambiguities: ['没有说明选择标准'],
                        suggestedSkillId: 'relocation-planning',
                      }),
                    },
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 }
      );
    }) as typeof fetch;
    try {
      const { expressionMode: _explicitMode, ...defaultModeRequest } =
        request('我在两个地方之间拿不定主意');
      const response = await POST(
        new Request('http://localhost/api/life-ledger/assistant', {
          method: 'POST',
          body: JSON.stringify(defaultModeRequest),
        })
      );
      const payload = (await response.json()) as {
        mode: string;
        perception: AgentPerception;
        plan: AgentPlan;
        decision: { type: string; question?: string };
      };
      assert.equal(payload.mode, 'model-perception');
      assert.equal(payload.perception.source, 'model');
      assert.equal(payload.plan.skillId, 'relocation-planning');
      assert.equal(payload.decision.type, 'clarify');
      assert.match(payload.decision.question ?? '', /工作机会|家庭支持/);
      const capturedBody = sentBody as unknown as {
        tool_choice: { function: { name: string } };
      };
      assert.equal(
        capturedBody.tool_choice.function.name,
        'report_agent_perception'
      );
    } finally {
      globalThis.fetch = originalFetch;
      if (previousKey === undefined) delete process.env.DEEPSEEK_API_KEY;
      else process.env.DEEPSEEK_API_KEY = previousKey;
    }
  });

  it('keeps a structured medium-confidence clarification on the local fast path', async () => {
    const originalFetch = globalThis.fetch;
    const previousKey = process.env.DEEPSEEK_API_KEY;
    process.env.DEEPSEEK_API_KEY = 'test-key';
    let modelCalled = false;
    globalThis.fetch = (async () => {
      modelCalled = true;
      throw new Error('A safe structured clarification must stay local.');
    }) as typeof fetch;
    try {
      const { expressionMode: _explicitMode, ...defaultModeRequest } =
        request('我想去上海');
      const response = await POST(
        new Request('http://localhost/api/life-ledger/assistant', {
          method: 'POST',
          body: JSON.stringify(defaultModeRequest),
        })
      );
      const payload = (await response.json()) as {
        mode: string;
        decision: { type: string; question?: string };
      };
      assert.equal(response.status, 200);
      assert.equal(modelCalled, false);
      assert.equal(payload.mode, 'local-structured');
      assert.equal(payload.decision.type, 'clarify');
      assert.match(payload.decision.question ?? '', /上海.*哪座城市.*什么时候/);
    } finally {
      globalThis.fetch = originalFetch;
      if (previousKey === undefined) delete process.env.DEEPSEEK_API_KEY;
      else process.env.DEEPSEEK_API_KEY = previousKey;
    }
  });

  it('keeps an explicit local-mode request fully local', async () => {
    const originalFetch = globalThis.fetch;
    const previousKey = process.env.DEEPSEEK_API_KEY;
    process.env.DEEPSEEK_API_KEY = 'test-key';
    let modelCalled = false;
    globalThis.fetch = (async () => {
      modelCalled = true;
      throw new Error('Local mode must not call the model.');
    }) as typeof fetch;
    try {
      const response = await POST(
        new Request('http://localhost/api/life-ledger/assistant', {
          method: 'POST',
          body: JSON.stringify(request('我想去北京如何')),
        })
      );
      assert.equal(response.status, 200);
      assert.equal(modelCalled, false);
    } finally {
      globalThis.fetch = originalFetch;
      if (previousKey === undefined) delete process.env.DEEPSEEK_API_KEY;
      else process.env.DEEPSEEK_API_KEY = previousKey;
    }
  });

  it('replaces incompatible working memory on an intent switch', () => {
    const cityInput = request('我应该在上海还是北京');
    const cityPerception = perceiveTurnLocally(cityInput);
    const cityPlan = planPerceivedTurn(cityInput, cityPerception)!.plan;
    const first = updateWorkingMemory(
      null,
      context.planHash,
      cityPerception,
      cityPlan,
      '2026-10-23T00:00:00.000Z'
    );
    const investmentInput = request('我还能投入多少本金');
    const investmentPerception = perceiveTurnLocally(investmentInput);
    const investmentPlan = planPerceivedTurn(
      investmentInput,
      investmentPerception
    )!.plan;
    const second = updateWorkingMemory(
      first,
      context.planHash,
      investmentPerception,
      investmentPlan,
      '2026-10-23T00:01:00.000Z'
    );
    assert.notEqual(first.taskId, second.taskId);
    assert.deepEqual(second.slots.cities, []);
    assert.equal(second.intent, 'investment_capacity');
  });

  it('blocks a tool that is outside the planned Skill', () => {
    const input = request('比较上海和北京的生活成本');
    const perception: AgentPerception = {
      ...perceiveTurnLocally(input),
      suggestedSkillId: 'relocation-planning',
    };
    const decision = {
      type: 'tool' as const,
      reason: 'wrong tool',
      tool: { name: 'inspect_year' as const, arguments: { year: 2030 } },
    };
    const plan: AgentPlan = {
      version: '1.0.0',
      goal: perception.goal,
      skillId: 'relocation-planning',
      status: 'ready',
      steps: [
        {
          id: 'step-1',
          kind: 'tool',
          tool: 'inspect_year',
          purpose: 'invalid',
          completionCondition: 'invalid',
        },
      ],
      stopReason: null,
    };
    const validation = validatePlannedTurn(input, perception, plan, decision);
    assert.equal(validation.ok, false);
    assert.match(validation.errors.join(' '), /not allowed/);
  });

  it('derives a mandatory business Skill for every tool plan', () => {
    const input = request('查看 2030 年余额');
    const perception: AgentPerception = {
      ...perceiveTurnLocally(input),
      suggestedSkillId: null,
    };
    const decision = {
      type: 'tool' as const,
      reason: 'inspect the formal ledger',
      tool: { name: 'inspect_year' as const, arguments: { year: 2030 } },
    };
    const derived = buildPlanForDecision(perception, decision);
    assert.equal(derived.skillId, 'ledger-insight');
    assert.equal(
      validatePlannedTurn(input, perception, derived, decision).ok,
      true
    );
    assert.equal(
      validatePlannedTurn(
        input,
        perception,
        { ...derived, skillId: null },
        decision
      ).ok,
      false
    );
  });
});
