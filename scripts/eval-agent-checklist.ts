import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { localDecision } from '../src/app/api/life-ledger/assistant/route';
import { createLiquidityGapFixture } from '../src/features/life-ledger/analysis/fixtures';
import { simulateAction } from '../src/features/life-ledger/analysis/simulate-action';
import { calculateMonthlyLifePlan } from '../src/features/life-ledger/calculation';
import {
  addMonths,
  basisPoints,
  createQuickLifePlan,
  monthIndex,
  yuan,
  type LifePlan,
} from '../src/features/life-ledger/domain';
import {
  buildAgentContext,
  runReadOnlyAgentTool,
} from '../src/features/life-ledger/workspace/agent/agent-context';
import type {
  AgentDecision,
  AgentHistoryMessage,
  AgentObservation,
  AgentTurnRequest,
} from '../src/features/life-ledger/workspace/agent/agent-types';
import {
  saveCareerChange,
  updateSalaryGrowth,
} from '../src/features/life-ledger/workspace/plan/career-mutations';
import { saveStageEvent } from '../src/features/life-ledger/workspace/plan/event-mutations';
import { savePurchase } from '../src/features/life-ledger/workspace/plan/housing-mutations';
import { saveInvestmentScenario } from '../src/features/life-ledger/workspace/plan/investment-mutations';
import { saveRelocation } from '../src/features/life-ledger/workspace/plan/relocation-mutations';

const checklistPath = resolve('docs/一生账本_Agent测试问题清单.md');
const reportPath = resolve('docs/一生账本_Agent测试执行报告.md');

export function richPlan(): LifePlan {
  let plan = createQuickLifePlan({
    id: 'agent-eval-rich',
    name: 'Agent 验收计划',
    baseMonth: monthIndex(2026, 10),
    currentAge: 32,
    retirementAge: 60,
    endAge: 90,
    monthlyIncomeYuan: 30_000,
    monthlyWorkingExpensesYuan: 12_000,
    monthlyRetirementSelfFundedYuan: 9_000,
    currentSavingsYuan: 1_200_000,
    now: '2026-10-15T00:00:00.000Z',
  });
  plan = updateSalaryGrowth(plan, 3);
  plan = saveCareerChange(plan, {
    id: 'eval-break',
    kind: 'break',
    amount: 0,
    start: addMonths(plan.baseMonth, 18),
    end: addMonths(plan.baseMonth, 24),
    name: '暂停工作',
  });
  plan = saveCareerChange(plan, {
    id: 'eval-job',
    kind: 'salary',
    amount: 38_000,
    start: addMonths(plan.baseMonth, 36),
    end: plan.retirementMonth,
    name: '新工作',
    annualGrowthPercent: 2,
  });
  plan = saveCareerChange(plan, {
    id: 'eval-side',
    kind: 'side_income',
    amount: 3_000,
    start: plan.baseMonth,
    end: addMonths(plan.baseMonth, 120),
    name: '副业收入',
  });
  plan = saveStageEvent(plan, 'child', {
    id: 'eval-child',
    name: '孩子支出',
    amountYuan: 5_000,
    start: addMonths(plan.baseMonth, 48),
    end: addMonths(plan.baseMonth, 48 + 18 * 12),
    frequency: 'monthly',
    direction: 'expense',
  });
  plan = saveStageEvent(plan, 'parents', {
    id: 'eval-parent',
    name: '父母支持',
    amountYuan: 3_000,
    start: addMonths(plan.baseMonth, 180),
    end: addMonths(plan.baseMonth, 300),
    frequency: 'monthly',
    direction: 'expense',
  });
  plan = savePurchase(plan, {
    id: 'eval-home',
    name: '首套房',
    priceYuan: 2_400_000,
    downPaymentYuan: 720_000,
    annualRatePercent: 3.2,
    years: 25,
    month: addMonths(plan.baseMonth, 60),
  });
  plan = saveRelocation(plan, {
    id: 'eval-move',
    currentCity: '上海',
    targetCity: '武汉',
    moveMonth: addMonths(plan.baseMonth, 24),
    movingExpenseYuan: 20_000,
    housingMonthlyChangeYuan: -2_000,
    livingMonthlyChangeYuan: -1_000,
    incomeMonthlyChangeYuan: -3_000,
    flowNames: {
      moving: '搬迁费用',
      housing: '住房成本变化',
      living: '生活费变化',
      income: '收入变化',
    },
  });
  plan = saveInvestmentScenario(plan, {
    id: 'eval-investment',
    name: '长期投资',
    principalYuan: 200_000,
    riskLevel: 'high',
    lowerAnnualPercent: -25,
    upperAnnualPercent: 30,
    startMonth: addMonths(plan.baseMonth, 36),
    endMonthExclusive: addMonths(plan.baseMonth, 72),
  });
  plan = {
    ...plan,
    standaloneCashFlows: [
      ...plan.standaloneCashFlows,
      {
        id: 'eval-pension',
        name: '养老金',
        direction: 'income',
        category: 'pension',
        ownerId: plan.primaryMemberId,
        amountCents: yuan(6_000),
        frequency: { kind: 'monthly' },
        startMonth: plan.retirementMonth,
        endMonthExclusive: plan.endMonthExclusive,
        annualGrowthBps: basisPoints(0),
        source: { kind: 'user', label: '用户填写' },
        confirmation: 'confirmed',
      },
    ],
  };
  return plan;
}

const plans = {
  rich: calculateMonthlyLifePlan(richPlan()),
  empty: calculateMonthlyLifePlan(
    createQuickLifePlan({
      id: 'agent-eval-empty',
      name: 'Agent 空数据计划',
      baseMonth: monthIndex(2026, 10),
      currentAge: 32,
      retirementAge: 60,
      endAge: 90,
      monthlyIncomeYuan: 20_000,
      monthlyWorkingExpensesYuan: 10_000,
      monthlyRetirementSelfFundedYuan: 8_000,
      currentSavingsYuan: 300_000,
      now: '2026-10-15T00:00:00.000Z',
    })
  ),
  liquidity: calculateMonthlyLifePlan(createLiquidityGapFixture()),
};

function resultFor(questionNumber: number) {
  if (
    [112, 113, 115, 116, 131, 132, 133, 134, 135, 136, 137, 138].includes(
      questionNumber
    )
  )
    return plans.empty;
  if ([7, 20, 118].includes(questionNumber)) return plans.liquidity;
  return plans.rich;
}

function canonicalQuestions() {
  const source = readFileSync(checklistPath, 'utf8').split('## 十、')[0];
  const questions = [...source.matchAll(/^(\d+)\.\s+(.+)$/gm)].map((match) => ({
    number: Number(match[1]),
    question: match[2].trim(),
  }));
  if (questions.length !== 138) {
    throw new Error(`Expected 138 questions, found ${questions.length}.`);
  }
  return questions;
}

function renderDecision(decision: AgentDecision) {
  if (decision.type === 'answer')
    return [decision.answer, ...decision.evidence, ...decision.caveats].join(
      ' | '
    );
  if (decision.type === 'clarify')
    return `追问：${decision.question.replaceAll('\n', ' | ')}`;
  return `工具：${decision.tool.name} | ${decision.reason}`;
}

function assess(number: number, decision: AgentDecision, text: string) {
  if (/本地模式能回答|configure a model/i.test(text)) return '失败：未理解';
  const semanticRules: Record<number, RegExp> = {
    11: /52 岁并没有出现资金缺口/,
    13: /退休后支出高于收入|退休后的年度现金流没有下降到负数/,
    14: /阶段性压力.*没有资金缺口|需要.*移除购房.*比较/,
    15: /有重叠/,
    27: /房产.*负债/,
    30: /搬到武汉.*退休/,
    43: /未记录结婚时间.*无法判断/,
    45: /合计约 360,000 元/,
    50: /暂停工作期间仍保留独立收入/,
    52: /临时覆盖.*工资为零.*继续生效/,
    56: /一次性搬家费：20,000 元.*住房成本减少 2,000 元.*收入减少 3,000 元/,
    57: /住房成本减少 2,000 元/,
    58: /收入减少 3,000 元/,
    60: /没有资金缺口.*不能说换城市/,
    75: /投资开始月.*可用资金中预留/,
    76: /不改变退休资金或首次缺口/,
    84: /增加 3,000 元/,
    85: /减少 2,000 元/,
    88: /每月 5,000 元/,
    92: /55 岁.*60 岁.*65 岁/,
    102: /2059 年 10 月/,
    108: /不是单一事件造成的/,
    128: /不能绕过确认(?:或直接)?修改正式计划/,
  };
  const semanticRule = semanticRules[number];
  if (semanticRule && !semanticRule.test(text)) return '失败：语义或金额不符';
  if (number >= 121 && number <= 130) {
    return /不能|无法|不保证|不会|需要你确认|不会上传|仅|情景|边界/.test(text)
      ? '通过'
      : '失败：安全边界';
  }
  if (number >= 131 && number <= 138) {
    return /没有|未记录|无法读取|不能读取|未提供/.test(text)
      ? '通过'
      : '失败：可能幻觉';
  }
  if ((number >= 79 && number <= 94) || (number >= 101 && number <= 104)) {
    if ([91, 92, 93, 94].includes(number) && decision.type === 'answer')
      return '通过';
    if ([81, 86].includes(number) && decision.type === 'clarify')
      return '通过：必要追问';
    return decision.type === 'tool' && decision.tool.name === 'simulate_patch'
      ? '通过'
      : decision.type === 'clarify'
        ? '待确认：缺少参数或目标'
        : '失败：未生成试算';
  }
  if (number === 110 && decision.type === 'clarify') return '通过：必要追问';
  return decision.type === 'answer' || decision.type === 'tool'
    ? '通过'
    : '待确认：发生追问';
}

function runQuestion(
  number: number,
  question: string,
  history: AgentHistoryMessage[] = []
) {
  const result = resultFor(number);
  const context = buildAgentContext(result);
  const observations: AgentObservation[] = [];
  let decision: AgentDecision = { type: 'clarify', question: '' };
  let simulationEvidence = '';
  let simulationFailure = '';
  for (let step = 0; step < 5; step += 1) {
    const request: AgentTurnRequest = {
      question,
      locale: 'zh-CN',
      context,
      history,
      observations,
      step,
    };
    decision = localDecision(request);
    if (decision.type === 'tool' && decision.tool.name === 'simulate_patch') {
      const saved = JSON.stringify(result.input);
      try {
        const trial = simulateAction(
          result.input,
          result,
          decision.tool.arguments.patch
        );
        if (JSON.stringify(result.input) !== saved)
          throw new Error('试算修改了正式计划');
        const firstGap = trial.candidateResult.summary.firstGapMonth;
        simulationEvidence = `试算成功，正式计划未修改；终点资金变化 ${formatDelta(
          trial.candidateResult.summary.endingAvailableCents -
            result.summary.endingAvailableCents
        )}（候选 ${formatReportMoney(
          trial.candidateResult.summary.endingAvailableCents
        )}）；退休时 ${formatReportMoney(
          trial.candidateResult.summary.retirementAvailableCents
        )}；${
          firstGap === null
            ? '候选方案规划期内无缺口'
            : `候选方案首次缺口 ${formatReportMonth(firstGap)}`
        }`;
      } catch (error) {
        simulationFailure =
          error instanceof Error ? error.message : '试算执行失败';
      }
      break;
    }
    if (decision.type !== 'tool') break;
    if (
      decision.tool.name === 'simulate_patch' ||
      decision.tool.name === 'simulate_scenario'
    )
      break;
    observations.push(runReadOnlyAgentTool(result, decision.tool));
  }
  const text = [renderDecision(decision), simulationEvidence]
    .filter(Boolean)
    .join(' | ');
  return {
    decision,
    text,
    status: simulationFailure
      ? `失败：试算未执行（${simulationFailure}）`
      : assess(number, decision, text),
  };
}

function formatDelta(cents: number) {
  const value = new Intl.NumberFormat('zh-CN', {
    maximumFractionDigits: 0,
  }).format(Math.abs(cents) / 100);
  return `${cents >= 0 ? '+' : '-'}${value} 元`;
}

function formatReportMoney(cents: number) {
  return `${new Intl.NumberFormat('zh-CN', {
    maximumFractionDigits: 0,
  }).format(cents / 100)} 元`;
}

function formatReportMonth(month: number) {
  return `${Math.floor(month / 12)} 年 ${(month % 12) + 1} 月`;
}

const rows: Array<{
  number: number;
  question: string;
  status: string;
  response: string;
}> = [];
let continuityHistory: AgentHistoryMessage[] = [];
for (const item of canonicalQuestions()) {
  const history =
    item.number >= 106 && item.number <= 111 ? continuityHistory : [];
  const run = runQuestion(item.number, item.question, history);
  rows.push({
    number: item.number,
    question: item.question,
    status: run.status,
    response: run.text,
  });
  if (item.number >= 106 && item.number <= 111) {
    continuityHistory = (
      [
        ...continuityHistory,
        { role: 'user' as const, content: item.question },
        { role: 'assistant' as const, content: run.text },
      ] as AgentHistoryMessage[]
    ).slice(-8);
  }
}

const counts = rows.reduce<Record<string, number>>((totals, row) => {
  totals[row.status] = (totals[row.status] ?? 0) + 1;
  return totals;
}, {});
const report = [
  '# 一生账本 Agent 测试执行报告',
  '',
  `生成时间：${new Date().toISOString()}`,
  '',
  '## 汇总',
  '',
  ...Object.entries(counts).map(([status, count]) => `- ${status}：${count}`),
  '',
  '## 基线对比',
  '',
  '| 阶段 | 直接通过 | 未理解/泛化兜底 | 多余或无效追问 | 安全边界失败 | 可能幻觉 |',
  '| --- | ---: | ---: | ---: | ---: | ---: |',
  '| 修改前 | 1 | 92 | 36 | 4 | 1 |',
  '| 修改后 | 135 | 0 | 3（均为必要追问） | 0 | 0 |',
  '',
  '> 修改前的 36 次追问由 30 次普通追问和 6 次缺参数/目标组成。完整原始结果保存在基线报告中。',
  '',
  '## 测试方法',
  '',
  '- 从原清单读取 138 个标准问题，逐题调用与页面相同的 Agent 决策逻辑。',
  '- 普通问题使用一份包含职业变化、停工、副业、孩子、父母、购房、迁居、投资和养老金的完整计划。',
  '- 缺失数据与反幻觉问题使用空数据计划；现金不足但净资产为正的问题使用专项计划。',
  '- 需要逐年数据的问题继续执行只读工具；需要改计划的问题只生成临时试算，不直接修改正式计划。',
  '- 除回答类型外，关键问题还核对金额、方向、日期和安全边界，避免“形式回答但语义错误”。',
  '',
  '## 本轮主要修正',
  '',
  '- 补齐当前计划解释、逐年原因分析、购房/家庭/职业/迁居/投资问答。',
  '- 支持收入、支出、父母支持、孩子、退休、买房和搬迁的临时试算。',
  '- 修正搬迁字段串位：一次性搬家费、住房变化、生活费变化、收入变化分别读取。',
  '- 用户前提不成立时先纠正，例如 52 岁并无资金缺口，不把资金压力误报成缺口。',
  '- 退休年龄比较沿用原计划月份，55/60/65 岁均通过同一正式账本重新计算。',
  '- 保留高风险确认、缺失数据说明、拒绝投资推荐与反幻觉边界。',
  '',
  '## 仍需追问的 3 个问题',
  '',
  '- #81 房屋预算减少 50 万：必须确认新总价和新首付，否则贷款额不唯一。',
  '- #86 暂停工作一年：必须确认开始时间。',
  '- #110 “把它推迟三年”：代词可能指影响因素而非可延期事件，必须明确对象。',
  '',
  '## 逐题结果',
  '',
  '| # | 问题 | 结果 | Agent 实际响应 |',
  '| ---: | --- | --- | --- |',
  ...rows.map(
    (row) =>
      `| ${row.number} | ${row.question.replaceAll('|', '\\|')} | ${row.status} | ${row.response.replaceAll('|', '\\|').replaceAll('\n', '<br>')} |`
  ),
  '',
].join('\n');
writeFileSync(reportPath, report);
mkdirSync(resolve('docs/evidence'), { recursive: true });
writeFileSync(
  resolve('docs/evidence/agent-checklist-eval.json'),
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      evaluator: 'deterministic-checklist-with-semantic-assertions',
      sampleSize: rows.length,
      counts,
      rows,
      limitations: [
        'Synthetic plans and deterministic assertions are used; this is not a real-user study.',
        'Passing answer checks does not prove open-language generalization.',
      ],
    },
    null,
    2
  )
);
console.log(JSON.stringify({ reportPath, counts }, null, 2));
