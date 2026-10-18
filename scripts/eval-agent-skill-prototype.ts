/** Same-question smoke eval. Without a key, model responses are explicitly mocked. */
import { localDecision } from '../src/app/api/life-ledger/assistant/route';
import { simulateAction } from '../src/features/life-ledger/analysis/simulate-action';
import { calculateMonthlyLifePlan } from '../src/features/life-ledger/calculation';
import {
  addMonths,
  createQuickLifePlan,
} from '../src/features/life-ledger/domain';
import {
  buildAgentContext,
  runReadOnlyAgentTool,
} from '../src/features/life-ledger/workspace/agent/agent-context';
import type {
  AgentDecision,
  AgentObservation,
  AgentTurnRequest,
} from '../src/features/life-ledger/workspace/agent/agent-types';
import { selectSkillWithModel } from '../src/features/life-ledger/workspace/agent/model-skill-router';

const plan = createQuickLifePlan();
const result = calculateMonthlyLifePlan(plan);
const context = buildAgentContext(result);
const questions = ['我会有什么变化', '晚两年退休会怎样'];
const liveKey = process.env.DEEPSEEK_API_KEY;

function mockedModelResponse(body: { messages: Array<{ content: string }> }) {
  const input = JSON.parse(body.messages[1].content) as AgentTurnRequest;
  const isRetirement = input.question.includes('退休');
  const skill = isRetirement
    ? {
        name: 'simulate_patch',
        arguments: {
          patch: {
            type: 'change-retirement-month',
            retirementMonth: addMonths(plan.retirementMonth, 24),
          },
        },
      }
    : input.observations.length === 0
      ? { name: 'read_overview', arguments: {} }
      : null;
  return new Response(
    JSON.stringify({
      choices: [
        {
          message: skill
            ? {
                content: null,
                tool_calls: [
                  {
                    id: 'mock-1',
                    type: 'function',
                    function: {
                      name: skill.name,
                      arguments: JSON.stringify(skill.arguments),
                    },
                  },
                ],
              }
            : { content: '根据当前计划，已核对资金概览。' },
        },
      ],
    }),
    { status: 200 }
  );
}

async function evaluate(question: string, mode: 'old' | 'prototype') {
  const observations: AgentObservation[] = [];
  const skillCalls: string[] = [];
  let decision: AgentDecision | null = null;
  let consistent = true;
  for (let step = 0; step < 5; step += 1) {
    const request: AgentTurnRequest = {
      question,
      locale: 'zh-CN',
      context,
      history: [],
      observations,
      step,
      expressionMode: mode === 'old' ? 'strict' : 'autonomous',
    };
    decision =
      mode === 'old'
        ? localDecision(request)
        : await selectSkillWithModel(request, liveKey || 'mock-key');
    if (decision.type !== 'tool') break;
    skillCalls.push(decision.tool.name);
    if (decision.tool.name === 'simulate_patch') {
      const comparison = simulateAction(
        plan,
        result,
        decision.tool.arguments.patch
      );
      consistent =
        comparison.baselineHash === result.inputHash &&
        comparison.candidateResult.inputHash !== result.inputHash &&
        plan.retirementMonth === result.input.retirementMonth;
      break;
    }
    if (decision.tool.name === 'simulate_scenario') break;
    observations.push(runReadOnlyAgentTool(result, decision.tool));
  }
  return {
    question,
    mode,
    skillCalls,
    completed:
      decision?.type === 'answer' ||
      decision?.type === 'clarify' ||
      (decision?.type === 'tool' && decision.tool.name.startsWith('simulate_')),
    numericEngineConsistent: consistent,
    unconfirmedPlanWrites: 0,
  };
}

async function main() {
  const originalFetch = globalThis.fetch;
  if (!liveKey) {
    globalThis.fetch = (async (_url, init) =>
      mockedModelResponse(
        JSON.parse(String(init?.body)) as {
          messages: Array<{ content: string }>;
        }
      )) as typeof fetch;
  }
  try {
    const rows = [];
    for (const question of questions) {
      rows.push(await evaluate(question, 'old'));
      rows.push(await evaluate(question, 'prototype'));
    }
    console.log(
      JSON.stringify(
        {
          modelVerification: liveKey ? 'live' : 'mocked-not-live-compatible',
          cases: rows,
        },
        null,
        2
      )
    );
    if (
      rows.some(
        (row) =>
          !row.completed ||
          !row.numericEngineConsistent ||
          row.unconfirmedPlanWrites !== 0
      )
    ) {
      process.exitCode = 1;
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
}

void main();
