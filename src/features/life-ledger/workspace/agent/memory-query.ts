import type { AgentMemoryContext } from './agent-types';

function bigrams(value: string) {
  const normalized = value.toLowerCase().replace(/\s+/g, '');
  const result = new Set<string>();
  for (let index = 0; index < normalized.length - 1; index += 1) {
    result.add(normalized.slice(index, index + 2));
  }
  for (const token of normalized.match(/[a-z0-9]+/g) ?? []) result.add(token);
  return result;
}

export function inferMemoryKind(text: string): AgentMemoryContext['kind'] {
  if (/简洁|一句话|先说结论|不要专业词|详细解释|表格/.test(text)) {
    return 'communication';
  }
  if (/必须|不要|不能|最多|至少|上限|底线|预算|预留/.test(text)) {
    return 'constraint';
  }
  return 'decision_preference';
}

export function queryAgentMemories(
  memories: AgentMemoryContext[],
  question: string,
  now = new Date()
) {
  const queryTerms = bigrams(question);
  const topics = ['投资', '退休', '买房', '孩子', '迁居', '城市'];
  return memories
    .filter(
      (memory) =>
        memory.status === 'active' &&
        (!memory.expiresAt ||
          new Date(memory.expiresAt).getTime() > now.getTime())
    )
    .map((memory) => {
      const overlaps = [...bigrams(memory.text)].filter((term) =>
        queryTerms.has(term)
      ).length;
      const score =
        overlaps * 2 +
        (memory.kind === 'communication' ? 3 : 0) +
        (topics.some(
          (topic) => question.includes(topic) && memory.text.includes(topic)
        )
          ? 4
          : 0);
      return { memory, score };
    })
    .filter((item) => item.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.memory.effectiveFrom.localeCompare(a.memory.effectiveFrom)
    )
    .slice(0, 3)
    .map((item) => item.memory);
}
