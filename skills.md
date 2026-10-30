# 账本 Agent Skills

本文描述应用内 Agent 的业务 Skills。Skill 是能够独立触发、执行和验收的业务能力；Function tools 是 Skill 使用的执行原语，两者不再混称。项目内的 `agent-skills/*/SKILL.md` 是设计与评测契约，运行时白名单由 `skill-registry.ts` 强制执行。

## 当前业务 Skills

| Skill ID              | 业务目标                           | 允许的 Function tools                                                                    | 关键边界                               |
| --------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------- |
| `ledger-insight`      | 查询并解释正式账本和资金边界       | `read_overview`、`get_annual_series`、`inspect_year`、`get_investment_capacity`          | 现金流上限不是投资建议                 |
| `scenario-planning`   | 生成人生事件或组合调整的临时试算   | `compare_retirement_ages`、`compare_child_timing`、`simulate_patch`、`simulate_scenario` | 试算绑定计划版本，确认前不写正式计划   |
| `relocation-planning` | 澄清城市选择并完成城市成本迁居试算 | `lookup_city_costs`、`simulate_relocation_candidate`                                     | 成本不能代替价值选择，演示数据非实时值 |

每个 Skill 都声明触发与不触发条件、输入上下文、执行步骤、完成标准和异常策略：

- `agent-skills/ledger-insight/SKILL.md`
- `agent-skills/scenario-planning/SKILL.md`
- `agent-skills/relocation-planning/SKILL.md`

配套 `evals/evals.json` 保存真实任务式样例，不只检查工具名称。

## Function tools

底层仍保留 10 个工具：`read_overview`、`get_annual_series`、`inspect_year`、`compare_retirement_ages`、`compare_child_timing`、`get_investment_capacity`、`lookup_city_costs`、`simulate_relocation_candidate`、`simulate_patch`、`simulate_scenario`。每个工具必须且只能归属一个业务 Skill，规划后的 Skill 与工具不匹配会被校验层拒绝。

`PlanPatch` 目前支持：移动收支发生时间、修改收支金额、修改退休月份、修改期初可用资金、移动或删除购置事项、移动或删除迁居事项。每种调整都要通过目标匹配和参数校验。

## Agent 如何使用

1. 在“分析”页打开规划助手；完整的 3 个业务 Skill 与 10 个 Function tools 记录在本文件和运行时注册表中。回答下方的 Trace 只展示本轮实际选择的 Skill，不在界面重复展示整张注册表。
2. 默认使用自适应智能分析。配置 `DEEPSEEK_API_KEY` 后，高置信核心意图和能形成安全澄清的中置信任务继续使用本地快路径；低置信或 `unknown` 输入由模型通过强制 Function Call 输出结构化感知结果，规划层再确定最小下一动作。Tool 一旦选定，程序会从唯一所属关系派生业务 Skill 并强制校验。遇到仍需动态选择的任务，第二次模型调用只能从注册表暴露的 Function tools 中选择。循环受最大步数、重复调用和总时限约束；单个智能步骤超过 5.5 秒时由客户端重试本地模式。当前默认模型名为 `deepseek-flash`，可通过 `DEEPSEEK_MODEL` 覆盖。
3. 本地执行器校验参数并调用账本的正式计算逻辑。金额和计算结果以本地计算为准；模型不能直接决定财务数字。
4. 涉及计划修改时，助手先给出试算候选项。只有用户明确确认后，才将变更应用到计划；计划版本变化时，旧候选项会失效。
5. 未配置模型密钥或模型不可用时，回退到现有本地回答。用户主动选择的本地模式不调用外部模型。

## 数据与状态

- 计划数据、Agent 任务进度和用户主动保存的长期偏好存放在浏览器 IndexedDB；这个原型没有新增后端数据库。
- 模型请求包含回答问题所需的精简计划上下文、近期对话和有限的工具观察结果，不发送完整账本数据库。配置模型服务前应确认其数据处理要求；不接受外发时应切换为本地模式。
- 长期偏好由用户查看、添加和删除；它不是模型自动写入的隐形记忆。
- 每轮先形成结构化感知结果，记录意图、目标、实体、约束、缺失字段和歧义。短期记忆保存跨轮指代和待确认候选；工作记忆只服务一个当前目标，保存 Skill、槽位、计划状态和缺失字段。意图切换时替换不兼容的工作记忆，避免旧金额污染新问题。
- 计划版本变化时短期状态失效；Memory、会话状态、正式计划事实分别存储，避免把偏好误当事实。

## 当前验证范围与限制

- 已有本地单元测试和模拟模型 Function Call，覆盖感知 Schema、规划、Skill 工具权限、工作记忆切换、候选确认与回退等关键路径。
- `npm run test:e2e:agent` 已通过真实 Next.js HTTP 路由验证：单城市迁居识别、多轮补充起点、系统架构自解释、确定性路由选择城市 Skill、进程内 MCP 返回带来源的演示候选、Observation 推进迁居副本试算、多轮“那年”指代、越权拦截和非法参数 400。证据写入 `docs/evidence/agent-api-journey.json`。
- `npm run test:e2e:offline` 已通过 6 个 Persona、断网冷启动、刷新、页面切换和浏览器进程重启；Agent 本身依赖服务端 API，不属于离线可用能力。
- 21 条分层感知样例的本地降级识别为 21/21；这是为本轮需求建立的开发集，包含截图回归，不是独立留出集，不能代表开放语料泛化。172 条边界集当前为 140/172；总体通过率达到本轮 80% 门槛，但越权修改、错误前提和信息不足专项仍未达门槛，因此仍不足以发布开放 Agent。
- 尚未用真实 DeepSeek 密钥完成结构化感知准确率评测，也未用真实远程城市数据源完成在线端到端验证；上线前需要补这两项验证。
- 自适应智能分析是默认入口，但 LLM 不是每轮必调：高置信输入保持本地快路径，只有低置信或 `unknown` 输入才尝试 DeepSeek。没有密钥、调用超时或失败时自动回退本地；用户主动切换的本地模式会在当前浏览器会话中保持。当前仍不能把“LLM 意图识别已编码且默认可触发”表述为“真实模型效果已经验证”。
- 当前实现直接调用 DeepSeek 兼容接口与官方 MCP TypeScript SDK，**没有集成 LangChain 或 LangGraph**。当前单 Agent、有限步 ReAct 已能覆盖同一事实源上的查询与试算，暂不为框架而引入框架。

## 实现位置

- 专业 Skill 契约：`agent-skills/*/SKILL.md`
- Skill 与 Function tools 注册：`src/features/life-ledger/workspace/agent/skill-registry.ts`
- LLM/本地感知：`src/features/life-ledger/workspace/agent/agent-perception.ts`
- 规划与校验：`agent-planner.ts`、`agent-validation.ts`
- 工作记忆：`working-memory.ts`
- 模型选择与结果解析：`src/features/life-ledger/workspace/agent/model-skill-router.ts`
- Agent 路由和本地回退：`src/app/api/life-ledger/assistant/route.ts`
- Query 改写与短期状态：`src/features/life-ledger/workspace/agent/query-resolution.ts`
- Memory 检索：`src/features/life-ledger/workspace/agent/memory-query.ts`
- MCP 客户端与服务端：`src/features/life-ledger/server/city-cost-mcp.ts`
- 任务及偏好存储：`src/features/life-ledger/storage/agent-state.ts`
- 界面展示：`src/features/life-ledger/workspace/agent/agent-panel.tsx`
