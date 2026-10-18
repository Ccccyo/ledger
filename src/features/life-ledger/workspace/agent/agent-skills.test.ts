import assert from 'node:assert/strict';
import { it } from 'node:test';

import { POST } from '../../../../app/api/life-ledger/assistant/route';
import { simulateScenario } from '../../analysis/simulate-action';
import { calculateMonthlyLifePlan } from '../../calculation';
import { addMonths, createQuickLifePlan, moneyCents } from '../../domain';
import { buildAgentContext, runReadOnlyAgentTool } from './agent-context';
import { parseAgentDecision } from './agent-decision';
import { selectSkillWithModel } from './model-skill-router';
import { AGENT_SKILLS, modelToolDeclarations } from './skill-registry';

const plan = createQuickLifePlan();
const result = calculateMonthlyLifePlan(plan);
const context = buildAgentContext(result);

it('publishes every executable Skill with a unique model declaration', () => {
  const ids = AGENT_SKILLS.map((skill) => skill.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(
    modelToolDeclarations().map((item) => item.function.name),
    ids
  );
  assert.deepEqual(ids, [
    'read_overview',
    'get_annual_series',
    'inspect_year',
    'compare_retirement_ages',
    'compare_child_timing',
    'simulate_patch',
    'simulate_scenario',
  ]);
});

it('accepts DeepSeek-compatible tool calls and uses local calculations', async () => {
  const originalFetch = globalThis.fetch;
  let sent: Record<string, unknown> | null = null;
  globalThis.fetch = (async (_url, init) => {
    sent = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: 'call-1',
                  type: 'function',
                  function: {
                    name: 'inspect_year',
                    arguments: JSON.stringify({ year: result.annual[0].year }),
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
    const decision = await selectSkillWithModel(
      {
        question: '哪一年会有变化？',
        locale: 'zh-CN',
        context,
        history: [],
        observations: [],
        step: 0,
        expressionMode: 'autonomous',
      },
      'test-key'
    );
    assert.equal(decision.type, 'tool');
    if (decision.type !== 'tool' || decision.tool.name !== 'inspect_year')
      return;
    const observation = runReadOnlyAgentTool(result, decision.tool);
    assert.equal(observation.ok, true);
    assert.equal(
      (observation.result as { closingAvailableCents: number })
        .closingAvailableCents,
      result.annual[0].closingAvailableCents
    );
    const sentBody = sent as unknown as Record<string, unknown>;
    assert.equal(sentBody.model, 'deepseek-flash');
    assert.equal((sentBody.tools as unknown[]).length, AGENT_SKILLS.length);
    const userPayload = JSON.parse(
      (sentBody.messages as Array<{ content: string }>)[1].content
    ) as Record<string, unknown>;
    assert.equal(
      'monthly' in (userPayload.plan as Record<string, unknown>),
      false
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

it('rejects fabricated or malformed Skill arguments', () => {
  assert.equal(
    parseAgentDecision({
      type: 'tool',
      reason: 'unsafe',
      tool: {
        name: 'delete_plan',
        arguments: {},
      },
    }),
    null
  );
  assert.equal(
    parseAgentDecision({
      type: 'tool',
      reason: 'unsafe',
      tool: {
        name: 'simulate_scenario',
        arguments: { patches: [{ type: 'delete-plan' }] },
      },
    }),
    null
  );
});

it('never promotes a model-written amount into a formal answer', async () => {
  const originalFetch = globalThis.fetch;
  const previousKey = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = 'test-key';
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content: '你会赚到 999999999 元。' } }],
      }),
      { status: 200 }
    )) as typeof fetch;
  try {
    const response = await POST(
      new Request('http://localhost/api/life-ledger/assistant', {
        method: 'POST',
        body: JSON.stringify({
          question: '我会有什么变化',
          locale: 'zh-CN',
          context,
          history: [],
          observations: [],
          step: 0,
          expressionMode: 'autonomous',
        }),
      })
    );
    const payload = (await response.json()) as {
      decision: { type: string; answer?: string };
      mode: string;
    };
    assert.equal(payload.mode, 'model-skills');
    assert.equal(JSON.stringify(payload.decision).includes('999999999'), false);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = previousKey;
  }
});

it('keeps combined simulation read-only and bound to the baseline version', () => {
  const patches = [
    {
      type: 'change-retirement-month' as const,
      retirementMonth: addMonths(plan.retirementMonth, 12),
    },
    {
      type: 'change-liquid-opening-balance' as const,
      assetId: plan.assets.find((asset) => asset.liquid)!.id,
      openingBalanceCents: moneyCents(100_000_00),
    },
  ];
  const comparison = simulateScenario(plan, result, patches);
  assert.equal(comparison.baselineHash, result.inputHash);
  assert.equal(plan.retirementMonth, result.input.retirementMonth);
  assert.notEqual(
    comparison.candidatePlan.retirementMonth,
    plan.retirementMonth
  );
  assert.equal(comparison.candidateResult.inputHash !== result.inputHash, true);
});
