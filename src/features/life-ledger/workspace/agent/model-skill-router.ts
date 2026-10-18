import { parseAgentDecision } from './agent-decision';
import type { AgentDecision, AgentTurnRequest } from './agent-types';
import { modelToolDeclarations } from './skill-registry';

/** A bounded, stateless compatibility adapter for DeepSeek's tool-call API. */
export async function selectSkillWithModel(
  input: AgentTurnRequest,
  apiKey: string
): Promise<AgentDecision> {
  const response = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    signal: AbortSignal.timeout(8_000),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.DEEPSEEK_MODEL || 'deepseek-flash',
      thinking: { type: 'disabled' },
      stream: false,
      max_tokens: 900,
      tool_choice: 'auto',
      tools: modelToolDeclarations(),
      messages: [
        {
          role: 'system',
          content: `You are Life Ledger's skill selector. Respond in ${input.locale.startsWith('zh') ? 'Simplified Chinese' : 'English'}. Choose the minimum useful skill(s), one at a time. Never calculate money yourself. All money values are integer cents and all month values are month indexes. Only cite observed results. If a required amount, target, year, or assumption is missing, ask exactly one concrete question instead of inventing it. A simulation is read-only until the user confirms it in the UI. If observations show an error, explain it or choose a different skill; do not repeat a failed call. After enough observations, answer concisely, including uncertainty. You may request at most one tool call in this response.`,
        },
        {
          role: 'user',
          content: JSON.stringify({
            question: input.question,
            recentConversation: input.history.slice(-4),
            plan: {
              planHash: input.context.planHash,
              baseMonth: input.context.baseMonth,
              endMonthExclusive: input.context.endMonthExclusive,
              retirementMonth: input.context.retirementMonth,
              currentAge: input.context.currentAge,
              summary: input.context.summary,
              keyEvents: input.context.keyEvents.map((event) => ({
                id: event.id,
                label: event.label,
                direction: event.direction,
                amountCents: event.amountCents,
                startMonth: event.startMonth,
                endMonthExclusive: event.endMonthExclusive,
              })),
              editableTargets: input.context.editableTargets,
            },
            observations: input.observations.slice(-4),
            userConfirmedPreferences: input.preferences?.slice(0, 5) ?? [],
            step: input.step,
          }),
        },
      ],
    }),
  });
  if (!response.ok) throw new Error(`Model returned ${response.status}`);
  const payload = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: string | null;
        tool_calls?: Array<{
          function?: { name?: string; arguments?: string };
        }>;
      };
    }>;
  };
  const message = payload.choices?.[0]?.message;
  if (!message) throw new Error('Model returned no message');
  const call = message.tool_calls?.[0]?.function;
  if (call) {
    let args: unknown;
    try {
      args = JSON.parse(call.arguments ?? '{}');
    } catch {
      throw new Error('Model returned invalid tool arguments');
    }
    const decision = parseAgentDecision({
      type: 'tool',
      reason: input.locale.startsWith('zh')
        ? `正在调用 ${call.name} 核对正式账本`
        : `Checking the formal ledger with ${call.name}`,
      tool: { name: call.name, arguments: args },
    });
    if (!decision) throw new Error('Model selected an invalid skill');
    return decision;
  }
  if (!message.content?.trim())
    throw new Error('Model returned an empty answer');
  if (/[?？]$/.test(message.content.trim())) {
    return { type: 'clarify', question: message.content.trim() };
  }
  return {
    type: 'answer',
    answer: message.content.trim(),
    evidence: [],
    caveats: [],
  };
}
