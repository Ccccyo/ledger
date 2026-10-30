import type { AgentQueryResolution, AgentTurnRequest } from './agent-types';

const citySuffix = '(?:市)?';

function cleanCity(value: string) {
  return value
    .replace(new RegExp(`${citySuffix}$`), '')
    .replace(/当前|现在|生活|成本|费用|差多少|怎么样|如何/g, '')
    .trim();
}

function cityPair(question: string) {
  const move = question.match(
    /(?:从|离开)\s*([\p{Script=Han}]{2,8})市?\s*(?:搬到|迁到|去)\s*([\p{Script=Han}]{2,8}?)(?:市)?(?=对|的|会|是否|，|。|$)/u
  );
  if (move) {
    return { fromCity: cleanCity(move[1]), toCity: cleanCity(move[2]) };
  }
  const compare = question.match(
    /([\p{Script=Han}]{2,8})市?\s*(?:和|与|对比|相比)\s*([\p{Script=Han}]{2,8})市?.*(?:生活成本|住房成本|租金|开销)/u
  );
  return compare
    ? { fromCity: cleanCity(compare[1]), toCity: cleanCity(compare[2]) }
    : null;
}

export function resolveAgentQuery(
  input: Pick<AgentTurnRequest, 'question' | 'history' | 'sessionState'>
): AgentQueryResolution {
  const originalQuestion = input.question.trim();
  let resolvedQuestion = originalQuestion;
  const preservedTerms = [
    ...originalQuestion.matchAll(
      /-?\d+(?:\.\d+)?\s*(?:元|万|年|月|岁|%|％)?|[一二两三四五六七八九十]+\s*(?:年|月|岁)|不要|不能|不改|不动|别动|没有|未/g
    ),
  ].map((match) => match[0]);
  const pair = cityPair(originalQuestion);
  const prior = input.sessionState;
  const working = prior?.workingMemory;
  const asksPrevious = /^(?:那|这|刚才|上一个|之前|就).*/.test(
    originalQuestion
  );

  if (
    asksPrevious &&
    /(?:用|按).*(?:数据|候选).*(?:试算|算一下|看看影响)/.test(
      originalQuestion
    ) &&
    prior?.pendingCityCandidate
  ) {
    resolvedQuestion = `使用已核验的城市候选数据，试算从${prior.pendingCityCandidate.fromCity}迁居到${prior.pendingCityCandidate.toCity}对当前正式计划的影响`;
  } else if (
    asksPrevious &&
    working?.intent === 'city_choice' &&
    working.slots.cities.length === 2 &&
    /成本|财务|账本|比较|看看/.test(originalQuestion)
  ) {
    resolvedQuestion = `使用演示数据比较${working.slots.cities[0]}和${working.slots.cities[1]}的生活成本及账本影响`;
  } else if (
    asksPrevious &&
    working?.intent === 'investment_capacity' &&
    /多少|上限|还能投|继续算/.test(originalQuestion)
  ) {
    const age = working.slots.ages.at(-1);
    const duration = working.slots.durationsYears.at(-1);
    resolvedQuestion = `计算还可以投入多少本金${age ? `，${age}岁开始` : ''}${duration ? `，持有${duration}年` : ''}`;
  } else if (
    /^(?:那时候|那年|当时).*(?:余额|资金|多少钱)/.test(originalQuestion) &&
    prior?.referencedYear
  ) {
    resolvedQuestion = `查看 ${prior.referencedYear} 年的余额和资金变化`;
  } else if (
    /^(?:(?:算了[，,]?\s*)?那就|算了[，,]?\s*改成|改成|还是)?\s*(提前|推迟|延后|晚)\s*([一二两三四五六七八九十\d]+)\s*年/.test(
      originalQuestion
    ) &&
    prior?.referencedEntity
  ) {
    resolvedQuestion = `将${
      prior.referencedEntity.type === 'retirement'
        ? '退休时间'
        : prior.referencedEntity.label
    }${originalQuestion}`;
  }

  const policyLike =
    /系统提示词|环境变量|api\s*key|其他用户|跨站|开发者模式|管理员命令|上传到|忽略.*规则/i.test(
      originalQuestion
    );
  const stateLike =
    /正式计划|哪些.*试算|试算.*(?:保存|生效)|有没有保存|是否生效|已经修改|恢复原来|哪个.*最新/.test(
      originalQuestion
    );
  const simulationLike = /试算|比较|推迟|提前|修改|移除|删除|影响/.test(
    resolvedQuestion
  );
  const planLike =
    /资金|收入|支出|余额|资产|负债|退休|投资|孩子|房|贷款|缺口|净资产|账本/.test(
      resolvedQuestion
    );
  const resolvedPair = pair ?? cityPair(resolvedQuestion);
  const intent: AgentQueryResolution['intent'] = policyLike
    ? 'safety_boundary'
    : stateLike
      ? 'state_query'
      : resolvedPair
        ? 'city_cost_lookup'
        : simulationLike
          ? 'simulation'
          : planLike
            ? 'plan_fact'
            : /你好|谢谢|聊聊|你是谁/.test(resolvedQuestion)
              ? 'conversation'
              : 'unknown';

  let referencedEntity = prior?.referencedEntity ?? null;
  if (/退休/.test(resolvedQuestion)) {
    referencedEntity = { type: 'retirement', id: null, label: '退休安排' };
  } else if (/买房|购房|房贷/.test(resolvedQuestion)) {
    referencedEntity = { type: 'purchase', id: null, label: '购房安排' };
  } else if (/投资|理财|基金/.test(resolvedQuestion)) {
    referencedEntity = { type: 'investment', id: null, label: '投资安排' };
  } else if (resolvedPair) {
    referencedEntity = {
      type: 'relocation',
      id: null,
      label: `${resolvedPair.fromCity} → ${resolvedPair.toCity}`,
    };
  }
  const year = resolvedQuestion.match(/(?:19|20|21)\d{2}/)?.[0];
  if (year && !prior?.referencedEntity) {
    referencedEntity = { type: 'year', id: year, label: `${year}年` };
  }

  return {
    originalQuestion,
    resolvedQuestion,
    intent,
    referencedEntity,
    cityPair: resolvedPair,
    unresolved: [],
    preservedTerms,
  };
}
