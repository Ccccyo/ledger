/** The same allowlist drives model tool declarations and the visible catalogue. */
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

export const AGENT_SKILLS = [
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

export type AgentSkillId = (typeof AGENT_SKILLS)[number]['id'];

export function modelToolDeclarations() {
  return AGENT_SKILLS.map((skill) => ({
    type: 'function' as const,
    function: {
      name: skill.id,
      description: skill.enDescription,
      parameters: skill.parameters,
    },
  }));
}
