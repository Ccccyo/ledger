export type BoundaryVerdict = '通过' | '部分通过' | '失败';
export type Severity = 'P0' | 'P1' | 'P2';

export interface BoundaryFailureInput {
  number: number;
  category: string;
  question: string;
  response: string;
  verdict: BoundaryVerdict;
  reason: string;
}

export interface BadCase extends BoundaryFailureInput {
  firstErrorNode:
    | 'policy'
    | 'perception'
    | 'context_validation'
    | 'planning'
    | 'tool_boundary'
    | 'response';
  rootCause: string;
  severity: Severity;
  priorityScore: number;
  impact: string;
  recommendedChange: string;
  regressionEvidence: string;
}

export interface GateResult {
  id: string;
  label: string;
  actual: number | string | null;
  target: number | string;
  passed: boolean;
  blocking: boolean;
  evidence: string;
}

const severityWeight: Record<Severity, number> = { P0: 100, P1: 60, P2: 30 };

function classifyNode(item: BoundaryFailureInput): BadCase['firstErrorNode'] {
  if (item.category === '注入与安全' || item.category === '越权修改')
    return 'policy';
  if (item.category === '错误前提') return 'context_validation';
  if (item.category === '矛盾要求') return 'planning';
  if (item.category === '实时数据') return 'tool_boundary';
  if (
    item.category === '极度模糊' ||
    item.category === '人生决策' ||
    item.category === '信息不足' ||
    item.category === '单位时间歧义' ||
    item.reason.includes('未理解')
  )
    return 'perception';
  if (item.category === '复杂长句' || item.category === '多轮对话')
    return 'planning';
  return 'response';
}

function classifyRootCause(item: BoundaryFailureInput) {
  // Category-specific business risks take precedence over the visible fallback
  // wording. Otherwise an authorization bypass would be mislabeled as a mere
  // response-quality issue and receive the wrong remediation owner.
  if (item.category === '错误前提') return 'premise_not_verified';
  if (item.category === '矛盾要求') return 'constraint_conflict_not_resolved';
  if (item.category === '单位时间歧义') return 'slot_ambiguity_not_clarified';
  if (item.category === '复杂长句') return 'task_not_decomposed';
  if (item.category === '情绪压力') return 'emotion_not_acknowledged';
  if (item.category === '越权修改') return 'write_boundary_not_explicit';
  if (item.category === '注入与安全') return 'security_policy_not_applied';
  if (item.category === '实时数据') return 'source_freshness_not_declared';
  if (item.category === '信息不足') return 'missing_fields_not_identified';
  if (item.category === '人生决策') return 'value_choice_boundary_missing';
  if (item.reason.includes('固定兜底')) return 'generic_fallback';
  return 'response_requirement_missed';
}

function severityFor(item: BoundaryFailureInput): Severity {
  if (item.category === '注入与安全' || item.category === '越权修改')
    return 'P0';
  if (
    item.category === '错误前提' ||
    item.category === '矛盾要求' ||
    item.category === '信息不足' ||
    item.category === '单位时间歧义' ||
    item.category === '实时数据' ||
    item.category === '情绪压力'
  )
    return 'P1';
  return 'P2';
}

function impactFor(node: BadCase['firstErrorNode']) {
  const values: Record<BadCase['firstErrorNode'], string> = {
    policy: '可能越权、绕过确认或产生安全边界不一致',
    perception: '误路由或无法利用已有上下文，用户需要重复表达',
    context_validation: '可能顺从错误前提并输出错误账本结论',
    planning: '任务不会被正确拆解、补参或停止',
    tool_boundary: '可能将缺失或过期外部数据当作已核验事实',
    response: '答案可能在情绪、清晰度或下一步上不可用',
  };
  return values[node];
}

function remediationFor(rootCause: string) {
  const values: Record<string, string> = {
    generic_fallback:
      '用结构化意图和页面上下文替代通用兜底；仅追问一个阻塞字段。',
    premise_not_verified:
      '在规划前比对正式账本、未确认候选与对话声明，明确纠正冲突。',
    constraint_conflict_not_resolved:
      '增加约束冲突类型，返回可完成部分并要求用户选择。',
    slot_ambiguity_not_clarified: '对金额、单位、时间和范围加入强制槽位校验。',
    task_not_decomposed:
      '规划器输出阶段目标与停止条件，每次只执行一个可验证动作。',
    emotion_not_acknowledged:
      '先识别情绪强度并回应，再给一个基于当前输入的最小下一步。',
    write_boundary_not_explicit:
      '在 policy 层统一拒绝永久授权和跳过确认，只允许候选试算。',
    security_policy_not_applied:
      '将注入、密钥、跨用户数据和外部指令放在模型前硬拦截。',
    source_freshness_not_declared:
      '要求外部值包含来源、地区、日期、口径与有效期，无源时停止。',
    missing_fields_not_identified:
      '从任务契约推导缺失槽位，先使用账本已有字段，再追问最小集合。',
    value_choice_boundary_missing:
      '分离可计算的财务比较和不可代替的价值选择，提供比较维度。',
    response_requirement_missed: '将简洁度、口径、情绪与下一步纳入回答后校验。',
  };
  return values[rootCause] ?? '为该失败增加针对性回归与程序校验。';
}

export function analyzeBadCase(item: BoundaryFailureInput): BadCase {
  const firstErrorNode = classifyNode(item);
  const rootCause = classifyRootCause(item);
  const severity = severityFor(item);
  const riskBonus =
    firstErrorNode === 'policy'
      ? 20
      : firstErrorNode === 'context_validation'
        ? 10
        : 0;
  return {
    ...item,
    firstErrorNode,
    rootCause,
    severity,
    priorityScore: severityWeight[severity] + riskBonus,
    impact: impactFor(firstErrorNode),
    recommendedChange: remediationFor(rootCause),
    regressionEvidence: `回归 #${item.number}；校验首错节点 ${firstErrorNode}，并重跑同类别全部用例。`,
  };
}

export function groupBadCases(cases: BadCase[]) {
  const byRootCause: Record<string, number> = {};
  const byFirstErrorNode: Record<string, number> = {};
  const bySeverity: Record<Severity, number> = { P0: 0, P1: 0, P2: 0 };
  for (const item of cases) {
    byRootCause[item.rootCause] = (byRootCause[item.rootCause] ?? 0) + 1;
    byFirstErrorNode[item.firstErrorNode] =
      (byFirstErrorNode[item.firstErrorNode] ?? 0) + 1;
    bySeverity[item.severity] += 1;
  }
  return { byRootCause, byFirstErrorNode, bySeverity };
}

export function numericGate(input: {
  id: string;
  label: string;
  actual: number | null;
  target: number;
  comparison?: 'gte' | 'lte' | 'eq';
  blocking?: boolean;
  evidence: string;
}): GateResult {
  const comparison = input.comparison ?? 'gte';
  return {
    id: input.id,
    label: input.label,
    actual: input.actual,
    target: input.target,
    passed:
      input.actual !== null &&
      (comparison === 'eq'
        ? input.actual === input.target
        : comparison === 'lte'
          ? input.actual <= input.target
          : input.actual >= input.target),
    blocking: input.blocking ?? true,
    evidence: input.evidence,
  };
}

export function statusGate(input: {
  id: string;
  label: string;
  actual: string | null;
  target: string;
  blocking?: boolean;
  evidence: string;
}): GateResult {
  return {
    ...input,
    passed: input.actual === input.target,
    blocking: input.blocking ?? true,
  };
}

export function releaseDecision(gates: GateResult[]) {
  const blockers = gates.filter((gate) => gate.blocking && !gate.passed);
  return {
    passed: blockers.length === 0,
    blockerIds: blockers.map((gate) => gate.id),
    gates,
  };
}
