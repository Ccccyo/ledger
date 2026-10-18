# 账本 Agent Skills

本文列出账本应用内规划助手目前提供的 Skill。这里的 Skill 是 Agent 可选择调用的业务工具，不是 Codex 的 `SKILL.md` 扩展包。

## 当前可用 Skills

| Skill ID | 用途 | 主要输入 | 结果与边界 |
| --- | --- | --- | --- |
| `read_overview` | 读取当前规划概览、首次资金缺口、退休节点和期末情况 | 无 | 只读；适合回答“我会有什么变化”等概览问题 |
| `get_annual_series` | 查询正式计算结果中的逐年数据 | 可选的起止年份 | 只读；用于观察趋势或定位变化年份 |
| `inspect_year` | 查看某一年的收入、支出和余额 | 年份 | 只读；回答指定年份的问题 |
| `compare_retirement_ages` | 比较不同退休年龄的结果 | 2–5 个退休年龄（40–80 岁） | 只做情景比较，不修改当前计划 |
| `compare_child_timing` | 比较子女规划开始时间、间隔和费用 | 起止年龄、间隔、供养年限、可选月费用 | 只做情景比较；缺少必要费用时应追问，不能凭空补金额 |
| `simulate_patch` | 试算单项计划调整，如推迟退休、修改收支或移动大额事件 | 一个结构化 `PlanPatch` | 仅生成候选方案；必须经用户确认才可写入计划 |
| `simulate_scenario` | 组合试算多个调整 | 2–3 个结构化 `PlanPatch` | 仅生成组合候选方案；必须经用户确认才可写入计划 |

`PlanPatch` 目前支持：移动收支发生时间、修改收支金额、修改退休月份、修改期初可用资金、移动或删除购置事项、移动或删除迁居事项。每种调整都要通过目标匹配和参数校验。

## Agent 如何使用

1. 在“分析”页打开规划助手；面板会展示全部 7 个可用 Skill，并标记本轮使用过的 Skill。
2. 自主模式配置 `DEEPSEEK_API_KEY` 后，由模型从注册表中的工具定义里选择 Skill、填写参数，并可根据工具结果继续选择下一步。当前默认模型名为 `deepseek-flash`，可通过 `DEEPSEEK_MODEL` 覆盖。
3. 本地执行器校验参数并调用账本的正式计算逻辑。金额和计算结果以本地计算为准；模型不能直接决定财务数字。
4. 涉及计划修改时，助手先给出试算候选项。只有用户明确确认后，才将变更应用到计划；计划版本变化时，旧候选项会失效。
5. 未配置模型密钥或模型不可用时，回退到现有本地回答。严格模式不调用外部模型。

## 数据与状态

- 计划数据、Agent 任务进度和用户主动保存的长期偏好存放在浏览器 IndexedDB；这个原型没有新增后端数据库。
- 模型请求包含回答问题所需的精简计划上下文、近期对话和有限的工具观察结果，不发送完整账本数据库。使用自主模式前仍应确认所选模型服务的数据处理要求。
- 长期偏好由用户查看、添加和删除；它不是模型自动写入的隐形记忆。

## 当前验证范围与限制

- 已有本地单元测试和模拟模型响应的同题评测，覆盖工具选择、参数校验、候选确认与回退等关键路径。
- 尚未用真实 DeepSeek 密钥完成在线端到端兼容性验证；生产构建也尚未确认完成。上线前需要补这两项验证。
- 当前实现直接调用 DeepSeek 兼容接口，**没有集成 LangChain 或 LangGraph**。先完成模型选 Skill 的纵向原型，再评估是否值得引入框架。

## 实现位置

- Skill 注册与参数定义：`src/features/life-ledger/workspace/agent/skill-registry.ts`
- 模型选择与结果解析：`src/features/life-ledger/workspace/agent/model-skill-router.ts`
- Agent 路由和本地回退：`src/features/life-ledger/workspace/agent/route.ts`
- 任务及偏好存储：`src/features/life-ledger/storage/agent-state.ts`
- 界面展示：`src/features/life-ledger/workspace/agent/agent-panel.tsx`
