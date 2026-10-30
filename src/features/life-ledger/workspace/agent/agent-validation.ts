import type {
  AgentDecision,
  AgentPerception,
  AgentPlan,
  AgentTurnRequest,
} from './agent-types';
import { AGENT_SKILLS, skillForTool } from './skill-registry';

export interface AgentValidationResult {
  ok: boolean;
  errors: string[];
}

/** Programmatic guard after planning; prompts never grant tool permission. */
export function validatePlannedTurn(
  input: AgentTurnRequest,
  perception: AgentPerception,
  plan: AgentPlan,
  decision: AgentDecision
): AgentValidationResult {
  const errors: string[] = [];
  if (plan.goal !== perception.goal)
    errors.push('Plan goal changed after perception.');
  if (decision.type !== 'tool') return { ok: errors.length === 0, errors };

  const owningSkill = skillForTool(decision.tool.name);
  if (!owningSkill)
    errors.push('Tool is not owned by a registered business Skill.');
  if (!plan.skillId) {
    errors.push('A tool plan must select a registered business Skill.');
  }
  if (plan.skillId && owningSkill && plan.skillId !== owningSkill.id) {
    errors.push('Planned Skill is not allowed to execute this tool.');
  }
  if (
    perception.suggestedSkillId &&
    !AGENT_SKILLS.some((skill) => skill.id === perception.suggestedSkillId)
  ) {
    errors.push('Perception selected an unknown Skill.');
  }
  if (
    (decision.tool.name === 'simulate_patch' ||
      decision.tool.name === 'simulate_scenario' ||
      decision.tool.name === 'simulate_relocation_candidate') &&
    !input.context.planHash
  ) {
    errors.push('A simulation must be bound to a plan version.');
  }
  return { ok: errors.length === 0, errors };
}
