import type {
  AgentPerception,
  AgentPlan,
  AgentWorkingMemory,
} from './agent-types';

function taskId(planHash: string, now: string) {
  return `${planHash.slice(0, 8)}:${now}`;
}

/**
 * Working memory belongs to one active goal. It is replaced on an intent
 * switch instead of concatenating unrelated conversation text.
 */
export function updateWorkingMemory(
  current: AgentWorkingMemory | null | undefined,
  planHash: string,
  perception: AgentPerception,
  plan: AgentPlan,
  now = new Date().toISOString()
): AgentWorkingMemory {
  const sameTask =
    current?.planHash === planHash &&
    (current.intent === perception.intent ||
      perception.intent === 'unknown' ||
      current.intent === 'unknown');
  const status: AgentWorkingMemory['status'] =
    plan.status === 'needs_input'
      ? 'collecting'
      : plan.status === 'ready'
        ? 'executing'
        : plan.status === 'complete'
          ? 'completed'
          : 'failed';
  return {
    version: '1.0.0',
    taskId: sameTask && current ? current.taskId : taskId(planHash, now),
    planHash,
    goal: perception.goal,
    intent: perception.intent,
    skillId: plan.skillId,
    slots: {
      cities: perception.entities.cities.length
        ? perception.entities.cities
        : sameTask
          ? (current?.slots.cities ?? [])
          : [],
      years: perception.entities.years.length
        ? perception.entities.years
        : sameTask
          ? (current?.slots.years ?? [])
          : [],
      ages: perception.entities.ages.length
        ? perception.entities.ages
        : sameTask
          ? (current?.slots.ages ?? [])
          : [],
      amountsCents: perception.entities.amountsCents.length
        ? perception.entities.amountsCents
        : sameTask
          ? (current?.slots.amountsCents ?? [])
          : [],
      durationsYears: perception.entities.durationsYears.length
        ? perception.entities.durationsYears
        : sameTask
          ? (current?.slots.durationsYears ?? [])
          : [],
    },
    constraints: perception.constraints,
    missingFields: perception.missingFields,
    ambiguities: perception.ambiguities,
    status,
    updatedAt: now,
  };
}
