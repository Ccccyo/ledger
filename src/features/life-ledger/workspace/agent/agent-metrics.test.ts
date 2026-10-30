import assert from 'node:assert/strict';
import { it } from 'node:test';

import { summarizeAgentQuality } from './agent-metrics';
import type { AgentTurnTrace } from './agent-types';

function trace(
  endToEndMs: number,
  outcome: AgentTurnTrace['outcome'],
  fallbackReason: string | null = null
): AgentTurnTrace {
  return {
    id: `${endToEndMs}-${outcome}`,
    totalMs: 1,
    perceptionMs: 0,
    planningMs: 0,
    perceptionSource: 'rule',
    intent: 'plan_fact',
    confidence: 'high',
    skillId: 'ledger-insight',
    decisionType: outcome === 'clarify' ? 'clarify' : 'answer',
    tool: null,
    fallbackReason,
    endToEndMs,
    stepCount: 1,
    toolCallCount: 0,
    outcome,
  };
}

it('summarizes end-to-end efficiency separately from voluntary feedback', () => {
  const summary = summarizeAgentQuality(
    [
      trace(100, 'answer'),
      trace(200, 'clarify', 'model unavailable'),
      trace(300, 'timeout'),
      trace(400, 'proposal'),
    ],
    [
      {
        role: 'assistant',
        feedback: {
          rating: 'helpful',
          reason: null,
          createdAt: '2026-10-24T00:00:00.000Z',
        },
      },
      {
        role: 'assistant',
        feedback: {
          rating: 'not_helpful',
          reason: 'slow',
          createdAt: '2026-10-24T00:01:00.000Z',
        },
      },
      { role: 'assistant' },
    ]
  );
  assert.deepEqual(summary, {
    completedSampleSize: 4,
    feedbackSampleSize: 2,
    helpfulCount: 1,
    helpfulRatePercent: 50,
    medianEndToEndMs: 200,
    p95EndToEndMs: 400,
    fallbackRatePercent: 25,
    clarificationRatePercent: 25,
    failureRatePercent: 25,
    negativeReasons: { slow: 1 },
  });
});

it('does not invent percentages when there is no sample', () => {
  assert.deepEqual(summarizeAgentQuality([], []), {
    completedSampleSize: 0,
    feedbackSampleSize: 0,
    helpfulCount: 0,
    helpfulRatePercent: null,
    medianEndToEndMs: null,
    p95EndToEndMs: null,
    fallbackRatePercent: null,
    clarificationRatePercent: null,
    failureRatePercent: null,
    negativeReasons: {},
  });
});
