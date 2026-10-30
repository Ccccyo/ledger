import { explainAgentSystem } from './agent-system-profile';
import type {
  AgentDecision,
  AgentPerception,
  AgentPlan,
  AgentTurnRequest,
} from './agent-types';
import { skillForTool } from './skill-registry';

function formatCents(cents: number) {
  return `${new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 }).format(
    cents / 100
  )} 元`;
}

function plan(
  perception: AgentPerception,
  decision: AgentDecision,
  purpose: string
): AgentPlan {
  const kind = decision.type;
  const skillId =
    kind === 'tool'
      ? (skillForTool(decision.tool.name)?.id ?? null)
      : perception.suggestedSkillId;
  return {
    version: '1.0.0',
    goal: perception.goal,
    skillId,
    status:
      kind === 'clarify'
        ? 'needs_input'
        : kind === 'answer'
          ? 'complete'
          : 'ready',
    steps: [
      {
        id: 'step-1',
        kind,
        tool: kind === 'tool' ? decision.tool.name : null,
        purpose,
        completionCondition:
          kind === 'tool'
            ? '工具返回通过 Schema 与业务校验的 Observation'
            : kind === 'clarify'
              ? '用户补充缺失字段或消除歧义'
              : '回答覆盖目标并标明必要边界',
      },
    ],
    stopReason:
      kind === 'answer'
        ? '已形成无需工具的完整回答'
        : kind === 'clarify'
          ? '缺少影响下一步的必要信息'
          : null,
  };
}

export interface PlannedAgentTurn {
  decision: AgentDecision;
  plan: AgentPlan;
}

/**
 * Converts a semantic frame into the smallest auditable next action. It does
 * not parse free-form language again and never invents money or dates.
 */
export function planPerceivedTurn(
  input: AgentTurnRequest,
  perception: AgentPerception
): PlannedAgentTurn | null {
  const zh = input.locale.startsWith('zh');
  const last = input.observations.at(-1);

  if (perception.intent === 'crisis_support') {
    const decision: AgentDecision = {
      type: 'answer',
      answer: zh
        ? '听起来你现在可能非常难受。你的安全最重要：如果你可能马上伤害自己，请立刻联系当地紧急服务，或请身边可信任的人现在陪着你。你此刻是否正处于危险中？'
        : 'It sounds like you may be in a lot of pain. If you may hurt yourself now, contact local emergency services or ask someone you trust to stay with you. Are you in immediate danger?',
      evidence: [],
      caveats: [],
    };
    return { decision, plan: plan(perception, decision, '优先处理即时安全') };
  }

  if (perception.intent === 'capability') {
    const decision: AgentDecision = {
      type: 'answer',
      answer: zh
        ? '我可以读取当前账本、解释资金变化、比较年份和退休方案、计算投资现金流边界，并用带来源的城市候选做迁居试算。涉及修改时，我只生成临时方案，必须由你确认后才会应用。'
        : 'I can inspect the ledger, explain changes, compare years or retirement options, calculate an investment cash-flow boundary, and simulate relocation candidates. Changes stay provisional until you confirm them.',
      evidence: [],
      caveats: [
        zh
          ? '我不能替你做价值选择、承诺投资收益，或把演示城市数据说成实时市场事实。'
          : 'I cannot make value choices for you, promise returns, or present demo city data as live market facts.',
      ],
    };
    return { decision, plan: plan(perception, decision, '说明能力与边界') };
  }

  if (perception.intent === 'system_explanation') {
    const decision: AgentDecision = {
      type: 'answer',
      answer: explainAgentSystem(
        input.question,
        input.expressionMode ?? 'autonomous',
        zh
      ),
      evidence: [
        zh
          ? '系统事实来自版本化能力清单，不由模型临时生成。'
          : 'System facts come from a versioned capability manifest, not model improvisation.',
      ],
      caveats: [
        zh
          ? '智能分析默认启用；未配置模型或模型不可用时会自动回退到本地感知。'
          : 'Smart analysis is enabled by default and falls back to local perception when no model is configured or available.',
      ],
    };
    return { decision, plan: plan(perception, decision, '解释系统实现与边界') };
  }

  if (perception.intent === 'feedback') {
    const decision: AgentDecision = {
      type: 'clarify',
      question: zh
        ? '你说得对，刚才的回答没有解决问题。请告诉我是“理解错了目标”“漏用了计划数据”，还是“回答方式不合适”？我会只修正这一点。'
        : 'You are right—the last answer did not solve the problem. Did I misunderstand the goal, miss plan data, or answer in the wrong way?',
    };
    return {
      decision,
      plan: plan(perception, decision, '收集可执行的纠错反馈'),
    };
  }

  if (perception.intent === 'city_choice') {
    const [first = '第一个城市', second = '第二个城市'] =
      perception.entities.cities;
    const decision: AgentDecision = {
      type: 'clarify',
      question: zh
        ? `选择 ${first} 还是 ${second} 取决于你的标准。你更想先比较“账本中的财务影响”，还是补充你对工作机会、家庭支持和生活偏好的排序？当前城市数据只适合做演示成本比较，不能替你做人生选择。`
        : `Choosing ${first} or ${second} depends on your criteria. Should we first compare ledger impact, or rank career, family support, and lifestyle preferences?`,
    };
    return { decision, plan: plan(perception, decision, '澄清城市选择标准') };
  }

  if (
    perception.intent === 'city_cost_comparison' ||
    perception.intent === 'relocation_simulation'
  ) {
    if (last?.tool === 'lookup_city_costs') return null;
    const [fromCity, toCity] = perception.entities.cities;
    if (perception.entities.cities.length === 1) {
      const targetCity = perception.entities.cities[0];
      const decision: AgentDecision = {
        type: 'clarify',
        question: zh
          ? `我理解你想评估迁居 ${targetCity} 对当前计划的影响。你现在从哪座城市出发，预计什么时候搬？我会先查询带来源的城市成本候选，再做临时试算。`
          : `I understand that you want to assess moving to ${targetCity}. Which city would you move from, and when? I will first retrieve a sourced city-cost candidate and then run a provisional simulation.`,
      };
      return {
        decision,
        plan: plan(perception, decision, '补充迁居起点与时间'),
      };
    }
    if (!fromCity || !toCity) {
      const decision: AgentDecision = {
        type: 'clarify',
        question: zh
          ? '请告诉我要比较的两座城市。'
          : 'Which two cities should I compare?',
      };
      return { decision, plan: plan(perception, decision, '补充城市参数') };
    }
    if (
      /最新|当前|今天|实时|官方/.test(input.question) &&
      !/演示|样例|模拟/.test(input.question)
    ) {
      const decision: AgentDecision = {
        type: 'answer',
        answer: zh
          ? '当前没有接入可证明为最新的城市市场数据，因此我不能把演示数据当作实时结论。'
          : 'No verified live city-market source is connected, so I cannot present demo data as current fact.',
        evidence: [],
        caveats: [
          zh
            ? `可以明确使用演示数据比较 ${fromCity} 与 ${toCity}，用于验证 MCP 和试算流程。`
            : 'You can explicitly request a demo-data comparison to test the MCP and simulation flow.',
        ],
      };
      return {
        decision,
        plan: plan(perception, decision, '说明数据新鲜度边界'),
      };
    }
    const decision: AgentDecision = {
      type: 'tool',
      reason: `通过只读 MCP 查询 ${fromCity} → ${toCity} 的城市成本候选。`,
      tool: {
        name: 'lookup_city_costs',
        arguments: {
          fromCity,
          toCity,
          householdSize: input.context.householdSize,
          housingMode: 'unknown',
        },
      },
    };
    return {
      decision,
      plan: plan(perception, decision, '取得带来源的城市成本候选'),
    };
  }

  if (perception.intent === 'investment_capacity') {
    if (last?.tool === 'get_investment_capacity') return null;
    const existing =
      input.context.investments.length === 1
        ? input.context.investments[0]
        : null;
    const age = perception.entities.ages.at(-1) ?? null;
    const duration = perception.entities.durationsYears.at(-1) ?? null;
    const startMonth = existing
      ? existing.startMonth
      : age !== null && input.context.primaryBirthMonth !== null
        ? input.context.primaryBirthMonth + age * 12
        : null;
    const endMonthExclusive = existing
      ? existing.endMonthExclusive
      : startMonth !== null && duration !== null
        ? startMonth + duration * 12
        : null;
    if (input.context.investments.length > 1 && age === null) {
      const decision: AgentDecision = {
        type: 'clarify',
        question: '你想追加到哪一笔投资？也可以告诉我开始年龄和持有年限。',
      };
      return { decision, plan: plan(perception, decision, '定位投资对象') };
    }
    if (startMonth === null || endMonthExclusive === null) {
      const decision: AgentDecision = {
        type: 'clarify',
        question:
          '准备从几岁或哪个月开始，预计持有多久？我会按正式账本计算可投入的现金流上限。',
      };
      return { decision, plan: plan(perception, decision, '补充投资期间') };
    }
    const decision: AgentDecision = {
      type: 'tool',
      reason: '读取投资期间的逐月可用资金，计算追加本金的现金流边界。',
      tool: {
        name: 'get_investment_capacity',
        arguments: { startMonth, endMonthExclusive },
      },
    };
    return { decision, plan: plan(perception, decision, '计算投资现金流边界') };
  }

  if (perception.intent === 'plan_explanation') {
    const decision: AgentDecision = {
      type: 'answer',
      answer: zh
        ? '投资本金会在投入时减少可用资金；投资情景中的收益区间用于展示未来可能范围，但不会被当作确定现金收入。本金越大，投入当期的可用资金越低，出现资金缺口的风险也可能更早。'
        : 'Investment principal reduces available cash when invested. Scenario returns show a possible range, not guaranteed cash income. More principal lowers available cash at the start and may bring a funding gap forward.',
      evidence: [
        zh
          ? `当前正式计划包含 ${input.context.investments.length} 笔投资情景。`
          : `The current plan contains ${input.context.investments.length} investment scenario(s).`,
      ],
      caveats: [
        zh
          ? '如需计算具体影响，还需要指定本金、开始时间和持有期限。'
          : 'A concrete comparison requires principal, start time, and holding period.',
      ],
    };
    return {
      decision,
      plan: plan(perception, decision, '解释投资与可用资金的关系'),
    };
  }

  if (perception.intent === 'retirement_assessment') {
    const retirementAge = input.context.retirementAge ?? '设定年龄';
    const firstGap = input.context.summary.firstGapMonth;
    const decision: AgentDecision = {
      type: 'answer',
      answer:
        firstGap === null
          ? `按当前正式计划，在 ${retirementAge} 岁退休并计算到 ${input.context.endAge ?? '规划终点'} 岁，规划期内没有出现资金缺口。`
          : `按当前正式计划，在 ${retirementAge} 岁退休后会出现资金缺口；可以继续定位缺口年份或比较推迟退休方案。`,
      evidence: [
        `退休时可用资金 ${formatCents(input.context.summary.retirementAvailableCents)}。`,
        `计划版本：${input.context.planHash.slice(0, 8)}。`,
      ],
      caveats: ['这是基于当前输入的试算结果，不是对未来的保证。'],
    };
    return { decision, plan: plan(perception, decision, '核对退休可行性') };
  }

  if (perception.intent === 'plan_overview') {
    const decision: AgentDecision = {
      type: 'tool',
      reason: '读取当前正式计划的资金、退休和缺口概览。',
      tool: { name: 'read_overview', arguments: {} },
    };
    return { decision, plan: plan(perception, decision, '读取正式计划概览') };
  }

  if (perception.intent === 'unknown') {
    const decision: AgentDecision = {
      type: 'clarify',
      question: zh
        ? '我还不能可靠判断你的目标。你是想查看当前账本、试算投资/退休/迁居变化，还是了解这个 Agent 的能力与架构？'
        : 'I cannot reliably identify the goal yet. Do you want to inspect the ledger, simulate an investment/retirement/relocation change, or understand this Agent?',
    };
    return {
      decision,
      plan: plan(perception, decision, '澄清未识别的任务目标'),
    };
  }

  return null;
}

export function buildPlanForDecision(
  perception: AgentPerception,
  decision: AgentDecision
) {
  return plan(perception, decision, '沿用确定性协调器完成当前动作');
}
