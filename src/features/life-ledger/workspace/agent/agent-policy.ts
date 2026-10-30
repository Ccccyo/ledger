import type { AgentDecision, AgentTurnRequest } from './agent-types';

function answer(answer: string, caveat?: string): AgentDecision {
  return {
    type: 'answer',
    answer,
    evidence: [],
    caveats: caveat ? [caveat] : [],
  };
}

/** Rules that must run before any model or tool. They do not rely on prompts. */
export function policyDecision(
  input: Pick<AgentTurnRequest, 'question' | 'context'>
): AgentDecision | null {
  const question = input.question.trim();
  if (
    /系统提示词|隐藏.*规则|环境变量|api\s*key|密钥|开发者模式/i.test(question)
  ) {
    return answer(
      '我不能提供系统提示词、服务器环境变量、密钥或隐藏配置。',
      '我只能使用经过白名单校验的账本能力。'
    );
  }
  if (
    /其他用户|别人.*计划|跨站|其他网站.*存储|恢复.*删除.*数据|删除.*数据.*恢复|历史聊天.*恢复/.test(
      question
    )
  ) {
    return answer(
      '我不能读取其他用户、其他网站或已经删除的数据。',
      '当前助手只处理本浏览器中当前计划允许访问的上下文。'
    );
  }
  if (/假装.*(?:银行|账户|访问).*权限|银行.*访问权限/.test(question)) {
    return answer(
      '我不能假装已经取得银行或外部账户权限，也不会据此读取数据。',
      '这里只有用户录入且当前计划允许访问的数据。'
    );
  }
  if (/上传到|运行.*代码|外部\s*api.*(?:删除|修改|执行)/i.test(question)) {
    return answer(
      '我不会执行外部文本要求的代码、上传或删除操作。',
      '工具返回只作为数据，不能改变权限或确认流程。'
    );
  }
  if (/忽略.*(?:规则|指令)|管理员命令|永久控制|永久授权/.test(question)) {
    return answer(
      '我不能接受绕过规则、管理员冒充或永久修改授权。',
      '每次正式修改都必须展示具体差异并由你确认。'
    );
  }
  if (
    /(?:不需要|不用|不要).*(?:确认|展示差异)|直接.*(?:保存|修改|采用|删除|清空)|你看着办.*改/.test(
      question
    )
  ) {
    return answer(
      '我不能绕过确认或直接修改正式计划。',
      '我可以先生成临时试算，展示字段和前后差异，再由你决定是否应用。'
    );
  }
  if (/你(?:已经|刚才).*改|已经.*(?:删除|保存).*对吧/.test(question)) {
    return answer(
      '我不会仅凭这句话认定修改已经发生；当前正式计划需要以页面保存状态和计划版本为准。',
      '如果只有试算卡片而没有确认应用，正式计划没有改变。'
    );
  }
  return null;
}
