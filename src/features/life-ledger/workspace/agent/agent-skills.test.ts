import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';

import { POST } from '../../../../app/api/life-ledger/assistant/route';
import { simulateScenario } from '../../analysis/simulate-action';
import { calculateMonthlyLifePlan } from '../../calculation';
import { addMonths, createQuickLifePlan, moneyCents } from '../../domain';
import { buildAgentContext, runReadOnlyAgentTool } from './agent-context';
import { parseAgentDecision } from './agent-decision';
import { selectSkillWithModel } from './model-skill-router';
import {
  AGENT_SKILLS,
  AGENT_TOOLS,
  modelToolDeclarations,
  skillForTool,
} from './skill-registry';

const plan = createQuickLifePlan();
const result = calculateMonthlyLifePlan(plan);
const context = buildAgentContext(result);

it('publishes every executable tool with a unique model declaration', () => {
  const ids = AGENT_TOOLS.map((tool) => tool.id);
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
    'get_investment_capacity',
    'lookup_city_costs',
    'simulate_relocation_candidate',
    'simulate_patch',
    'simulate_scenario',
  ]);
});

it('groups tools into independently testable business Skills', () => {
  assert.deepEqual(
    AGENT_SKILLS.map((skill) => skill.id),
    ['ledger-insight', 'scenario-planning', 'relocation-planning']
  );
  for (const tool of AGENT_TOOLS) {
    const owners = AGENT_SKILLS.filter((skill) =>
      skill.allowedTools.includes(tool.id)
    );
    assert.equal(
      owners.length,
      1,
      `${tool.id} must belong to exactly one business Skill`
    );
    const skill = skillForTool(tool.id);
    assert.ok(skill, `${tool.id} must belong to one business Skill`);
    assert.ok(skill.procedure.length >= 3);
    assert.ok(skill.successCriteria.length >= 2);
    assert.ok(skill.failurePolicy.length >= 2);
  }
});

it('keeps executable Skill metadata aligned with SKILL.md contracts', () => {
  for (const skill of AGENT_SKILLS) {
    const source = readFileSync(
      path.resolve('agent-skills', skill.id, 'SKILL.md'),
      'utf8'
    );
    assert.match(source, new RegExp(`name: ${skill.id}`));
    assert.match(
      source,
      new RegExp(`version: ${skill.version.replaceAll('.', '\\.')}`)
    );
    assert.match(source, /## 输入/);
    assert.match(source, /## 执行流程/);
    assert.match(source, /## 停止与异常/);
    assert.match(source, /## 验收/);
    const evalSet = JSON.parse(
      readFileSync(
        path.resolve('agent-skills', skill.id, 'evals', 'evals.json'),
        'utf8'
      )
    ) as {
      skill_name?: string;
      evals?: Array<{ prompt?: string; expectations?: string[] }>;
    };
    assert.equal(evalSet.skill_name, skill.id);
    assert.ok((evalSet.evals?.length ?? 0) >= 2);
    for (const item of evalSet.evals ?? []) {
      assert.ok(item.prompt?.trim());
      assert.ok((item.expectations?.length ?? 0) >= 2);
    }
  }
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
    assert.equal((sentBody.tools as unknown[]).length, AGENT_TOOLS.length);
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

it('falls back to structured local clarification and never promotes model-written amounts', async () => {
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
    assert.equal(payload.mode, 'local-structured');
    assert.equal(payload.decision.type, 'clarify');
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
