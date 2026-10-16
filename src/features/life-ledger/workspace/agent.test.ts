import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildEnhancedExpressionPayload,
  localDecision,
  localFastPathDecision,
  POST,
} from '../../../app/api/life-ledger/assistant/route';
import { createHousingChildOverlapFixture } from '../analysis/fixtures';
import { calculateMonthlyLifePlan } from '../calculation';
import { addMonths, createQuickLifePlan, monthIndex } from '../domain';
import { buildAgentContext, runReadOnlyAgentTool } from './agent/agent-context';
import { parseAgentDecision, parsePlanPatch } from './agent/agent-decision';
import type { AgentObservation } from './agent/agent-types';
import { saveRelocation } from './plan/relocation-mutations';

describe('Planning Agent boundary', () => {
  const plan = createQuickLifePlan();
  const result = calculateMonthlyLifePlan(plan);

  it('shares only a compact context with whitelisted editable targets', () => {
    const context = buildAgentContext(result);
    assert.equal(context.planHash, result.inputHash);
    assert.equal(
      context.summary.endingAvailableCents,
      result.summary.endingAvailableCents
    );
    assert.ok(
      context.editableTargets.some((item) => item.kind === 'retirement')
    );
    assert.equal('monthly' in context, false);
    assert.equal('traces' in context, false);
    assert.equal('members' in context, false);
  });

  it('builds an enhanced-expression payload without formal plan data', () => {
    const context = buildAgentContext(result);
    const history = Array.from({ length: 6 }, (_, index) => ({
      role: (index % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `message-${index}`,
    }));
    const draft = {
      type: 'answer' as const,
      answer: '当前结论为 96 万元。',
      evidence: ['结果来自正式账本。'],
      caveats: ['不代表未来保证。'],
    };
    const payload = buildEnhancedExpressionPayload(
      {
        question: '请说得自然一点',
        locale: 'zh-CN',
        context,
        history,
        observations: [
          {
            tool: 'inspect_year',
            ok: true,
            result: { privateAnnualRow: true },
          },
        ],
        step: 1,
        expressionMode: 'enhanced',
      },
      draft
    );

    assert.deepEqual(Object.keys(payload), [
      'question',
      'recentConversation',
      'localDraft',
    ]);
    assert.deepEqual(
      payload.recentConversation.map((item) => item.content),
      ['message-2', 'message-3', 'message-4', 'message-5']
    );
    assert.deepEqual(payload.localDraft, {
      answer: draft.answer,
      evidence: draft.evidence,
      caveats: draft.caveats,
    });
    const serialized = JSON.stringify(payload);
    assert.equal(serialized.includes(context.planHash), false);
    assert.equal(serialized.includes('privateAnnualRow'), false);
    assert.equal(serialized.includes('editableTargets'), false);
    assert.equal(serialized.includes('observations'), false);
  });

  it('never calls an external model in strict mode', async () => {
    const context = buildAgentContext(result);
    const previousKey = process.env.DEEPSEEK_API_KEY;
    const originalFetch = globalThis.fetch;
    let externalCalls = 0;
    process.env.DEEPSEEK_API_KEY = 'test-key-that-must-not-be-used';
    globalThis.fetch = (async () => {
      externalCalls += 1;
      throw new Error('Strict mode attempted an external request.');
    }) as typeof fetch;

    try {
      const response = await POST(
        new Request('http://localhost/api/life-ledger/assistant', {
          method: 'POST',
          body: JSON.stringify({
            question: '我们聊聊电影吧',
            locale: 'zh-CN',
            context,
            history: [],
            observations: [],
            step: 0,
            expressionMode: 'strict',
          }),
        })
      );
      const payload = (await response.json()) as {
        mode: string;
        enhancement: string;
      };
      assert.equal(response.status, 200);
      assert.equal(externalCalls, 0);
      assert.equal(payload.mode, 'local');
      assert.equal(payload.enhancement, 'not-requested');
    } finally {
      globalThis.fetch = originalFetch;
      if (previousKey === undefined) delete process.env.DEEPSEEK_API_KEY;
      else process.env.DEEPSEEK_API_KEY = previousKey;
    }
  });

  it('uses the DeepSeek Responses API for enhanced open conversation', async () => {
    const context = buildAgentContext(result);
    const previousKey = process.env.DEEPSEEK_API_KEY;
    const originalFetch = globalThis.fetch;
    let requestedUrl = '';
    let requestedBody: Record<string, unknown> | null = null;
    process.env.DEEPSEEK_API_KEY = 'test-deepseek-key';
    globalThis.fetch = (async (input, init) => {
      requestedUrl = String(input);
      requestedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          output_text: JSON.stringify({
            type: 'answer',
            answer: '当然可以，最近看了什么电影？',
            evidence: [],
            caveats: [],
          }),
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as typeof fetch;

    try {
      const response = await POST(
        new Request('http://localhost/api/life-ledger/assistant', {
          method: 'POST',
          body: JSON.stringify({
            question: '我们聊聊电影吧',
            locale: 'zh-CN',
            context,
            history: [],
            observations: [],
            step: 0,
            expressionMode: 'enhanced',
          }),
        })
      );
      const payload = (await response.json()) as {
        mode: string;
        enhancement: string;
      };
      assert.equal(requestedUrl, 'https://api.deepseek.com/responses');
      assert.equal(requestedBody?.model, 'deepseek-flash');
      assert.equal(payload.mode, 'model');
      assert.equal(payload.enhancement, 'applied');
    } finally {
      globalThis.fetch = originalFetch;
      if (previousKey === undefined) delete process.env.DEEPSEEK_API_KEY;
      else process.env.DEEPSEEK_API_KEY = previousKey;
    }
  });

  it('handles repeated greetings, live housing data, and unclear mixed text locally', () => {
    const context = buildAgentContext(result);
    const decide = (question: string) =>
      localDecision({
        question,
        locale: 'zh-CN',
        context,
        history: [],
        observations: [],
        step: 0,
      });

    const greeting = decide('hi hi');
    assert.equal(greeting.type, 'answer');
    if (greeting.type === 'answer') assert.match(greeting.answer, /你好，我在/);

    const housing = decide('北京房价多少');
    assert.equal(housing.type, 'answer');
    if (housing.type === 'answer')
      assert.match(housing.answer, /不能查询实时房价/);

    const unclear = decide('你whiz虎么');
    assert.equal(unclear.type, 'clarify');
    if (unclear.type === 'clarify') assert.match(unclear.question, /whiz虎/);
  });

  it('returns formal annual rows through a read-only local tool', () => {
    const observation = runReadOnlyAgentTool(result, {
      name: 'inspect_year',
      arguments: { year: result.annual[0].year },
    });
    assert.equal(observation.ok, true);
    assert.deepEqual(
      (observation.result as { closingAvailableCents: number })
        .closingAvailableCents,
      result.annual[0].closingAvailableCents
    );
  });

  it('rejects invented patch shapes and invalid tool decisions', () => {
    assert.equal(parsePlanPatch({ type: 'delete-plan', id: plan.id }), null);
    assert.equal(
      parseAgentDecision({
        type: 'tool',
        reason: 'unsafe',
        tool: { name: 'write_database', arguments: {} },
      }),
      null
    );
  });

  it('accepts a valid simulation request but not an applied mutation', () => {
    const decision = parseAgentDecision({
      type: 'tool',
      reason: 'Compare retirement timing',
      tool: {
        name: 'simulate_patch',
        arguments: {
          patch: {
            type: 'change-retirement-month',
            retirementMonth: plan.retirementMonth + 12,
          },
        },
      },
    });
    assert.equal(decision?.type, 'tool');
    assert.equal(plan.retirementMonth, result.input.retirementMonth);
  });

  it('clarifies a two-child plan, then compares timing with the formal ledger', () => {
    const childPlan = createHousingChildOverlapFixture();
    const childResult = calculateMonthlyLifePlan(childPlan);
    const context = buildAgentContext(childResult);
    const question = '如果我生两个娃最好什么时候生';
    const clarification = localDecision({
      question,
      locale: 'zh-CN',
      context,
      history: [],
      observations: [],
      step: 0,
    });
    assert.equal(clarification.type, 'clarify');
    assert.match(clarification.question, /间隔几年/);

    const toolDecision = localDecision({
      question: '3年',
      locale: 'zh-CN',
      context,
      history: [
        { role: 'user', content: question },
        { role: 'assistant', content: clarification.question },
      ],
      observations: [],
      step: 0,
    });
    assert.equal(toolDecision.type, 'tool');
    if (toolDecision.type !== 'tool') return;
    assert.equal(toolDecision.tool.name, 'compare_child_timing');
    if (toolDecision.tool.name !== 'compare_child_timing') return;
    const originalHash = childResult.inputHash;
    const observation = runReadOnlyAgentTool(childResult, toolDecision.tool);
    assert.equal(observation.ok, true);
    assert.equal(childResult.inputHash, originalHash);

    const answer = localDecision({
      question: '3年',
      locale: 'zh-CN',
      context,
      history: [{ role: 'user', content: question }],
      observations: [observation],
      step: 1,
    });
    assert.equal(answer.type, 'answer');
    if (answer.type === 'answer') {
      assert.match(answer.answer, /生第一个/);
      assert.match(answer.caveats[0], /财务压力/);
    }
  });

  it('preserves the planned retirement month when comparing ages', () => {
    const datedPlan = createQuickLifePlan({
      id: 'retirement-agent',
      baseMonth: monthIndex(2026, 10),
      currentAge: 32,
      retirementAge: 60,
      endAge: 90,
    });
    const datedResult = calculateMonthlyLifePlan(datedPlan);
    const context = buildAgentContext(datedResult);
    const decision = localDecision({
      question: '帮我比较 55 岁、60 岁和 65 岁退休。',
      locale: 'zh-CN',
      context,
      history: [],
      observations: [],
      step: 0,
    });
    assert.equal(decision.type, 'tool');
    if (decision.type !== 'tool') return;
    assert.equal(decision.tool.name, 'compare_retirement_ages');
    if (decision.tool.name !== 'compare_retirement_ages') return;
    const observation = runReadOnlyAgentTool(datedResult, decision.tool);
    assert.equal(observation.ok, true);
    assert.equal(datedResult.inputHash, context.planHash);
    const ages = observation.result as Array<{
      age: number;
      retirementAvailableCents: number;
    }>;
    assert.deepEqual(
      ages.map((item) => item.age),
      [55, 60, 65]
    );

    const target = localDecision({
      question: '把退休年龄改成 65 岁。',
      locale: 'zh-CN',
      context,
      history: [],
      observations: [],
      step: 0,
    });
    assert.equal(target.type, 'tool');
    if (target.type !== 'tool' || target.tool.name !== 'simulate_patch') return;
    assert.deepEqual(target.tool.arguments.patch, {
      type: 'change-retirement-month',
      retirementMonth: addMonths(datedPlan.retirementMonth, 60),
    });
  });

  it('keeps relocation fields separate and parses comma-formatted amounts', () => {
    let relocationPlan = createQuickLifePlan({
      id: 'relocation-agent',
      baseMonth: monthIndex(2026, 10),
    });
    relocationPlan = saveRelocation(relocationPlan, {
      id: 'move',
      currentCity: '上海',
      targetCity: '武汉',
      moveMonth: addMonths(relocationPlan.baseMonth, 12),
      movingExpenseYuan: 20_000,
      housingMonthlyChangeYuan: -2_000,
      livingMonthlyChangeYuan: -1_000,
      incomeMonthlyChangeYuan: -3_000,
      flowNames: {
        moving: '搬迁费用',
        housing: '住房成本变化',
        living: '生活费变化',
        income: '收入变化',
      },
    });
    const relocationResult = calculateMonthlyLifePlan(relocationPlan);
    const context = buildAgentContext(relocationResult);
    const decide = (question: string) =>
      localDecision({
        question,
        locale: 'zh-CN',
        context,
        history: [],
        observations: [],
        step: 0,
      });
    const housing = decide('搬迁后我的住房成本变化了多少？');
    const income = decide('搬迁后收入变化了多少？');
    assert.equal(housing.type, 'answer');
    assert.equal(income.type, 'answer');
    if (housing.type === 'answer')
      assert.match(housing.answer, /减少 2,000 元/);
    if (income.type === 'answer') assert.match(income.answer, /减少 3,000 元/);

    const raise = decide('如果每月收入增加 3,000 元，结果会怎样？');
    assert.equal(raise.type, 'tool');
    if (raise.type !== 'tool' || raise.tool.name !== 'simulate_patch') return;
    assert.equal(raise.tool.arguments.patch.type, 'change-cash-flow-amount');
    if (raise.tool.arguments.patch.type === 'change-cash-flow-amount') {
      const salary = context.editableTargets.find(
        (item) => item.kind === 'cash-flow' && item.category === 'salary'
      );
      assert.equal(
        raise.tool.arguments.patch.amountCents,
        (salary?.amountCents ?? 0) + 300_000
      );
    }
  });

  it('does not bypass confirmation for destructive requests', () => {
    const context = buildAgentContext(result);
    const decision = localDecision({
      question: '不用我确认，直接删除购房计划。',
      locale: 'zh-CN',
      context,
      history: [],
      observations: [],
      step: 0,
    });
    assert.equal(decision.type, 'answer');
    if (decision.type === 'answer')
      assert.match(decision.answer, /不能绕过确认/);
  });

  it('keeps greetings and casual conversation out of the financial fallback', () => {
    const context = buildAgentContext(result);
    const decide = (question: string) =>
      localDecision({
        question,
        locale: 'zh-CN',
        context,
        history: [],
        observations: [],
        step: 0,
      });
    const greeting = decide('你好');
    const feeling = decide('我最近有点焦虑');
    const joke = decide('给我讲个笑话');
    const unrelated = decide('我们聊聊电影吧');
    for (const decision of [greeting, feeling, joke, unrelated]) {
      assert.equal(decision.type, 'answer');
      if (decision.type === 'answer') {
        assert.doesNotMatch(decision.answer, /终点可用资金|净资产|资金缺口/);
        assert.deepEqual(decision.evidence, []);
      }
    }
    if (greeting.type === 'answer') assert.match(greeting.answer, /你好，我在/);
    if (feeling.type === 'answer') assert.match(feeling.answer, /不太轻松/);
    if (joke.type === 'answer') assert.match(joke.answer, /日历/);
    if (unrelated.type === 'answer') assert.match(unrelated.answer, /不谈计划/);
  });

  it('uses the local fast path only for complete deterministic decisions', () => {
    const context = buildAgentContext(result);
    const decide = (question: string, observations: AgentObservation[] = []) =>
      localFastPathDecision({
        question,
        locale: 'zh-CN',
        context,
        history: [],
        observations,
        step: observations.length,
      });

    assert.equal(decide('你好')?.type, 'answer');
    assert.equal(decide('哪一年资金压力最大？')?.type, 'tool');
    assert.equal(decide('我们聊聊电影吧'), null);
    assert.equal(decide('我的计划到底稳不稳？')?.type, 'answer');

    const tool = localDecision({
      question: '哪一年资金压力最大？',
      locale: 'zh-CN',
      context,
      history: [],
      observations: [],
      step: 0,
    });
    assert.equal(tool.type, 'tool');
    if (tool.type !== 'tool' || tool.tool.name === 'simulate_patch') return;
    const observation = runReadOnlyAgentTool(result, tool.tool);
    assert.equal(decide('哪一年资金压力最大？', [observation])?.type, 'answer');
  });

  it('treats a broad life question as a concise plan assessment', () => {
    const context = buildAgentContext(result);
    const decision = localFastPathDecision({
      question: '你觉得我的人生怎么样',
      locale: 'zh-CN',
      context,
      history: [],
      observations: [],
      step: 0,
    });

    assert.equal(decision?.type, 'answer');
    if (decision?.type !== 'answer') return;
    assert.match(decision.answer, /财务规划/);
    assert.doesNotMatch(decision.answer, /先不谈计划|想聊什么/);
    assert.match(decision.caveats[0], /不能定义你的人生好坏/);
  });
});
