import type { AgentExpressionMode } from './agent-types';

export const AGENT_ARCHITECTURE_VERSION = '1.1.0';

/**
 * Auditable product facts used for self-explanation. Keeping these facts in
 * code prevents a language model from inventing tools, permissions or data
 * flows when users ask how the Agent works.
 */
export const AGENT_SYSTEM_PROFILE = {
  architecture: 'bounded-single-agent',
  layers: [
    'policy',
    'perception',
    'planning',
    'validation',
    'execution',
    'memory',
    'observation',
  ],
  model: 'DeepSeek (optional semantic perception and expression)',
  planStorage: 'browser IndexedDB',
  writePolicy: 'simulation first; explicit user confirmation before apply',
} as const;

export function explainAgentSystem(
  question: string,
  mode: AgentExpressionMode = 'autonomous',
  zh = true
) {
  const asksPerception =
    /意图|识别|听不懂|不明白|怎么理解|为什么.*(?:错|unknown)/i.test(question);
  const modeLabel =
    mode === 'autonomous'
      ? zh
        ? '智能分析'
        : 'autonomous analysis'
      : mode === 'enhanced'
        ? zh
          ? '表述优化'
          : 'enhanced expression'
        : zh
          ? '本地分析'
          : 'local analysis';

  if (!zh) {
    return asksPerception
      ? `Intent recognition uses a high-precision local classifier first. In ${modeLabel} mode, low-confidence or unknown inputs may be sent to an LLM through a schema-constrained function call; policy, validation, calculations, and write approval remain deterministic.`
      : `This is a bounded single Agent (architecture ${AGENT_ARCHITECTURE_VERSION}): policy → perception → planning → validation → tool execution → observation. It uses three business Skills, browser working memory, deterministic ledger calculations, and explicit confirmation before any formal-plan change. Current mode: ${modeLabel}.`;
  }

  return asksPerception
    ? `当前意图识别先走高精度本地规则；在“${modeLabel}”模式下，低置信度或 unknown 输入才会升级到 LLM Function Call。LLM 负责语义分类和槽位抽取，权限、参数校验、账本计算与写入确认仍由程序强制保证。`
    : `当前是有边界的单 Agent（架构版本 ${AGENT_ARCHITECTURE_VERSION}）：策略校验 → 感知 → 规划 → 计划校验 → 工具执行 → 观察结果。系统包含 3 个业务 Skill、浏览器工作记忆和确定性账本计算；正式计划修改必须由你确认。当前模式：${modeLabel}。`;
}
