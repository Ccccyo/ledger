import type { AgentBusinessSkillId, AgentToolCall } from './agent-types';

export interface AgentSkillDefinition {
  id: AgentBusinessSkillId;
  version: string;
  name: string;
  purpose: string;
  triggers: string[];
  nonTriggers: string[];
  allowedTools: AgentToolCall['name'][];
  requiredContext: string[];
  procedure: string[];
  successCriteria: string[];
  failurePolicy: string[];
}

/**
 * Business Skills describe complete, independently testable capabilities.
 * Function tools below are execution primitives, not Skills by themselves.
 */
export const AGENT_SKILLS: AgentSkillDefinition[] = [
  {
    id: 'ledger-insight',
    version: '1.0.0',
    name: '账本事实与资金解释',
    purpose:
      '依据当前正式计划回答资金、年份、退休可行性和投资现金流边界问题，并清楚区分事实、解释和建议。',
    triggers: [
      '查询当前计划概览或指定年份',
      '解释收入、支出、余额、净资产和投资本金的影响',
      '计算在明确投资期间内不产生资金缺口的本金边界',
    ],
    nonTriggers: [
      '要求直接修改正式计划',
      '要求推荐具体证券或承诺收益',
      '需要实时市场价格但没有可核验数据源',
    ],
    allowedTools: [
      'read_overview',
      'get_annual_series',
      'inspect_year',
      'get_investment_capacity',
    ],
    requiredContext: ['planHash', 'summary', 'keyEvents', 'investments'],
    procedure: [
      '识别查询对象、时间范围、单位和必要约束',
      '缺少会影响计算的时间或对象时只追问最少字段',
      '调用只读账本工具并核对工具结果所属计划版本',
      '回答时标明结果是事实、现金流边界还是情景解释',
    ],
    successCriteria: [
      '金额来自正式计算结果而不是模型生成',
      '回答覆盖用户问题并包含必要口径',
      '没有把现金流上限表达为投资建议',
    ],
    failurePolicy: [
      '工具失败时不引用旧金额',
      '年份超界或对象不唯一时明确追问',
      '实时数据缺失时说明边界和可用替代方案',
    ],
  },
  {
    id: 'scenario-planning',
    version: '1.0.0',
    name: '人生事件与方案试算',
    purpose:
      '把退休、育儿、购置、收支或组合调整转换为可验证的临时方案，对比前后结果并等待用户确认。',
    triggers: [
      '比较退休年龄或育儿时间',
      '提出明确的计划调整或组合情景',
      '要求查看某个变化对资金曲线的影响',
    ],
    nonTriggers: [
      '仅查询当前账本事实',
      '目标对象、调整幅度或时间均不明确',
      '要求跳过确认直接写入',
    ],
    allowedTools: [
      'compare_retirement_ages',
      'compare_child_timing',
      'simulate_patch',
      'simulate_scenario',
    ],
    requiredContext: ['planHash', 'editableTargets', 'summary'],
    procedure: [
      '解析目标对象、调整值、时间和约束',
      '核对对象存在且参数属于允许范围',
      '只在计划副本上执行试算并生成前后差异',
      '把候选方案置为待确认，确认前不修改正式计划',
    ],
    successCriteria: [
      '候选方案绑定生成时的 planHash',
      '展示具体变更和关键资金差异',
      '只有用户确认且计划版本未变化时才能应用',
    ],
    failurePolicy: [
      '参数缺失时只追问影响下一步的字段',
      '计划版本变化时使候选失效',
      '试算失败时保留正式计划并报告失败原因',
    ],
  },
  {
    id: 'relocation-planning',
    version: '1.0.0',
    name: '城市选择与迁居试算',
    purpose:
      '澄清城市选择标准，查询带来源的城市成本候选，并把已核验候选用于现有迁居事项的临时试算。',
    triggers: [
      '比较两座城市的成本',
      '讨论在两个城市之间如何选择',
      '评估已存在迁居安排对正式计划的影响',
    ],
    nonTriggers: [
      '没有说明城市且无法从工作记忆恢复',
      '要求把演示数据说成实时市场事实',
      '只凭成本数据要求替用户做人生价值选择',
    ],
    allowedTools: ['lookup_city_costs', 'simulate_relocation_candidate'],
    requiredContext: ['householdSize', 'relocations', 'planHash'],
    procedure: [
      '区分城市选择、成本比较和迁居试算三种目标',
      '城市选择缺少评价标准时先澄清，不直接推荐',
      '通过 MCP 查询带来源、日期和声明的只读候选',
      '候选匹配现有迁居事项后才生成临时试算',
    ],
    successCriteria: [
      '城市、家庭人数和住房方式参数有效',
      '候选结果包含来源、版本、观察时间和免责声明',
      '正式计划在用户确认前保持不变',
    ],
    failurePolicy: [
      'MCP 超时或数据缺失时不使用猜测值',
      '候选城市与迁居事项不匹配时停止试算',
      '真实数据不可用时明确说明演示边界',
    ],
  },
];

/** The same allowlist drives model Function Calling and runtime validation. */
const patchParameters = {
  type: 'object',
  description:
    'One PlanPatch: type plus its matching IDs and numeric fields. Ask when target or value is missing.',
  properties: {
    type: {
      type: 'string',
      enum: [
        'shift-cash-flow',
        'change-cash-flow-amount',
        'change-retirement-month',
        'change-liquid-opening-balance',
        'shift-purchase',
        'remove-purchase',
        'shift-relocation',
        'remove-relocation',
      ],
    },
    cashFlowId: { type: 'string' },
    assetId: { type: 'string' },
    purchaseId: { type: 'string' },
    relocationId: { type: 'string' },
    monthDelta: { type: 'integer' },
    amountCents: { type: 'integer' },
    openingBalanceCents: { type: 'integer' },
    retirementMonth: { type: 'integer' },
  },
  required: ['type'],
  additionalProperties: false,
};

export const AGENT_TOOLS = [
  {
    id: 'read_overview',
    zh: '读取计划概览',
    en: 'Read plan overview',
    zhDescription: '读取资金缺口、退休与终点资金等摘要。',
    enDescription: 'Read gap, retirement and ending-balance summaries.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    id: 'get_annual_series',
    zh: '查询年度账本',
    en: 'Query annual ledger',
    zhDescription: '按年份范围读取正式计算结果。',
    enDescription: 'Read calculated results over a year range.',
    parameters: {
      type: 'object',
      properties: {
        startYear: { type: ['integer', 'null'] },
        endYear: { type: ['integer', 'null'] },
      },
      required: ['startYear', 'endYear'],
      additionalProperties: false,
    },
  },
  {
    id: 'inspect_year',
    zh: '检查单一年份',
    en: 'Inspect one year',
    zhDescription: '核对指定年份的收支和资金余额。',
    enDescription: 'Inspect income, expenses and balances for one year.',
    parameters: {
      type: 'object',
      properties: { year: { type: 'integer' } },
      required: ['year'],
      additionalProperties: false,
    },
  },
  {
    id: 'compare_retirement_ages',
    zh: '比较退休年龄',
    en: 'Compare retirement ages',
    zhDescription: '按正式计算引擎比较多个退休年龄。',
    enDescription: 'Compare retirement ages with the calculation engine.',
    parameters: {
      type: 'object',
      properties: { ages: { type: 'array', items: { type: 'integer' } } },
      required: ['ages'],
      additionalProperties: false,
    },
  },
  {
    id: 'compare_child_timing',
    zh: '比较育儿时间',
    en: 'Compare child timing',
    zhDescription: '比较不同生育时间的资金压力。缺少预算时需追问。',
    enDescription: 'Compare child timing; ask for a missing budget.',
    parameters: {
      type: 'object',
      properties: {
        startAge: { type: 'integer' },
        endAge: { type: 'integer' },
        spacingYears: { type: 'integer' },
        monthlyCostCents: { type: ['integer', 'null'] },
        supportYears: { type: 'integer' },
      },
      required: [
        'startAge',
        'endAge',
        'spacingYears',
        'monthlyCostCents',
        'supportYears',
      ],
      additionalProperties: false,
    },
  },
  {
    id: 'get_investment_capacity',
    zh: '计算投资现金流边界',
    en: 'Calculate investment cash-flow capacity',
    zhDescription: '按正式逐月账本计算投资期间不产生资金缺口的本金边界。',
    enDescription:
      'Calculate the principal boundary that stays gap-free during a holding period.',
    parameters: {
      type: 'object',
      properties: {
        startMonth: { type: 'integer' },
        endMonthExclusive: { type: 'integer' },
      },
      required: ['startMonth', 'endMonthExclusive'],
      additionalProperties: false,
    },
  },
  {
    id: 'lookup_city_costs',
    zh: '查询城市成本候选',
    en: 'Look up a city-cost candidate',
    zhDescription:
      '通过只读 MCP 数据源查询有来源和有效期的迁居成本候选；结果不能直接写入计划。',
    enDescription:
      'Use a read-only MCP source for a sourced relocation-cost candidate; never write it directly.',
    parameters: {
      type: 'object',
      properties: {
        fromCity: { type: 'string', minLength: 2, maxLength: 40 },
        toCity: { type: 'string', minLength: 2, maxLength: 40 },
        householdSize: { type: 'integer', minimum: 1, maximum: 8 },
        housingMode: { type: 'string', enum: ['rent', 'own', 'unknown'] },
      },
      required: ['fromCity', 'toCity', 'householdSize', 'housingMode'],
      additionalProperties: false,
    },
  },
  {
    id: 'simulate_relocation_candidate',
    zh: '试算城市成本候选',
    en: 'Simulate a city-cost candidate',
    zhDescription:
      '只使用上一条已核验城市 Observation 更新已有迁居安排的临时副本。',
    enDescription:
      'Apply the last verified city observation to an existing relocation in a temporary copy.',
    parameters: {
      type: 'object',
      properties: { relocationId: { type: 'string', minLength: 1 } },
      required: ['relocationId'],
      additionalProperties: false,
    },
  },
  {
    id: 'simulate_patch',
    zh: '单项变化试算',
    en: 'Simulate one change',
    zhDescription: '只生成修改前后对比；写入计划必须由用户确认。',
    enDescription: 'Compare before and after; only the user can apply.',
    parameters: {
      type: 'object',
      properties: {
        patch: patchParameters,
      },
      required: ['patch'],
      additionalProperties: false,
    },
  },
  {
    id: 'simulate_scenario',
    zh: '组合情景试算',
    en: 'Simulate combined scenario',
    zhDescription: '同时试算 2–3 项变化，统一对比后等待确认。',
    enDescription:
      'Combine two or three changes and compare before confirmation.',
    parameters: {
      type: 'object',
      properties: {
        patches: {
          type: 'array',
          items: patchParameters,
          minItems: 2,
          maxItems: 3,
        },
      },
      required: ['patches'],
      additionalProperties: false,
    },
  },
] as const;

export type AgentToolId = (typeof AGENT_TOOLS)[number]['id'];

export function skillForTool(tool: AgentToolCall['name']) {
  return (
    AGENT_SKILLS.find((skill) => skill.allowedTools.includes(tool)) ?? null
  );
}

export function modelToolDeclarations() {
  return AGENT_TOOLS.map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.id,
      description: tool.enDescription,
      parameters: tool.parameters,
    },
  }));
}
