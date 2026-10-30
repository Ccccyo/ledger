import type { AgentMessageFeedback, AgentTurnTrace } from './agent-types';

export interface AgentMetricMessage {
  role: 'user' | 'assistant';
  feedback?: AgentMessageFeedback;
}

export interface AgentQualitySummary {
  completedSampleSize: number;
  feedbackSampleSize: number;
  helpfulCount: number;
  helpfulRatePercent: number | null;
  medianEndToEndMs: number | null;
  p95EndToEndMs: number | null;
  fallbackRatePercent: number | null;
  clarificationRatePercent: number | null;
  failureRatePercent: number | null;
  negativeReasons: Partial<
    Record<NonNullable<AgentMessageFeedback['reason']>, number>
  >;
}

function nearestRank(values: number[], percentile: number) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.ceil(percentile * sorted.length) - 1);
  return sorted[index];
}

function rate(numerator: number, denominator: number) {
  return denominator === 0 ? null : Math.round((numerator / denominator) * 100);
}

/**
 * Local diagnostic summary. Voluntary ratings are directional feedback, not a
 * representative customer-satisfaction score or proof of task success.
 */
export function summarizeAgentQuality(
  traces: AgentTurnTrace[],
  messages: AgentMetricMessage[]
): AgentQualitySummary {
  const completed = traces.filter(
    (trace) =>
      typeof trace.endToEndMs === 'number' &&
      trace.endToEndMs >= 0 &&
      trace.outcome
  );
  const durations = completed.map((trace) => trace.endToEndMs!);
  const feedback = messages.flatMap((message) =>
    message.role === 'assistant' && message.feedback ? [message.feedback] : []
  );
  const helpfulCount = feedback.filter(
    (item) => item.rating === 'helpful'
  ).length;
  const negativeReasons: AgentQualitySummary['negativeReasons'] = {};
  for (const item of feedback) {
    if (item.rating !== 'not_helpful' || !item.reason) continue;
    negativeReasons[item.reason] = (negativeReasons[item.reason] ?? 0) + 1;
  }
  return {
    completedSampleSize: completed.length,
    feedbackSampleSize: feedback.length,
    helpfulCount,
    helpfulRatePercent: rate(helpfulCount, feedback.length),
    medianEndToEndMs: nearestRank(durations, 0.5),
    p95EndToEndMs: nearestRank(durations, 0.95),
    fallbackRatePercent: rate(
      completed.filter((trace) => Boolean(trace.fallbackReason)).length,
      completed.length
    ),
    clarificationRatePercent: rate(
      completed.filter((trace) => trace.outcome === 'clarify').length,
      completed.length
    ),
    failureRatePercent: rate(
      completed.filter(
        (trace) => trace.outcome === 'error' || trace.outcome === 'timeout'
      ).length,
      completed.length
    ),
    negativeReasons,
  };
}
