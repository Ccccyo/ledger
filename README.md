# 一生账本（Life Ledger）

一个面向长期生活规划的账本：从当前收支与资产出发，按年查看现金流、资金缺口和退休后的变化，并试算人生事件或计划调整的影响。

## 主要功能

- 建立个人基线，查看逐年账本、资金余额和关键节点。
- 规划收入、支出、住房、迁居、育儿、投资与退休等变化，比较不同方案。
- 使用分层规划助手查询计划、调用试算工具；支持 LLM 结构化感知、确定性规划与校验、短期记忆、单任务工作记忆、Function Calling 与城市成本 MCP 候选，修改计划前需要用户确认。业务 Skills 与底层工具见 [skills.md](./skills.md)。
- 在浏览器本地保存计划与助手状态；核心规划无需另建后端数据库。请定期导出备份，并注意清除浏览器数据会影响本地记录。

## 本地运行

需要 Node.js 20 或更高版本，以及 pnpm。在项目根目录执行：

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

然后打开 <http://localhost:3000>。核心账本功能可不配置数据库；如需使用依赖账户或服务端数据的模板功能，应按 `.env.example` 补齐相应配置。

如需体验模型自主选择 Skill，在 `.env.local` 中填写 `DEEPSEEK_API_KEY`。未配置时，规划助手使用本地确定性路由。城市数据默认通过进程内 MCP 传输读取带醒目标识的合成演示数据；只有配置 `CITY_DATA_MCP_URL` 才会连接远程 MCP 服务。不要把真实密钥提交到 Git。

## 验证

```bash
pnpm test:calculation
pnpm test:agent
pnpm eval:agent
pnpm eval:agent:skills
pnpm eval:agent:checklist
pnpm eval:agent:perception
pnpm eval:agent:boundary
pnpm eval:agent:report
pnpm eval:agent:gate:local
pnpm eval:agent:gate:open
pnpm build
pnpm test:e2e:agent
pnpm test:e2e:offline
```

`pnpm eval:agent` 是统一评测入口，依次运行 Agent 单测、138 题窄域验收、21 条感知开发集、172 题开放边界集、真实 HTTP 关键旅程和本地演示门禁。结果写入 `docs/evidence/agent-evaluation-summary.json`、`docs/evidence/agent-badcase-analysis.json` 和 `docs/一生账本_Agent开放边界与BadCase测试报告.md`；报告分别给出本地演示与开放 Agent 发布门禁，不能用前者替代后者。`eval:agent:gate:local` 和 `eval:agent:gate:open` 会在对应门禁未满足时返回非零退出码，可用于 CI；当前开放 Agent 门禁按预期未通过。

其中模型 Function Call 测试使用模拟响应，不等同于真实 DeepSeek 接口联调；`eval:agent:perception` 在未提供密钥时只评估本地降级识别，并在证据中明确记录 LLM 未运行。默认使用自适应智能分析：高置信任务，以及已经能形成安全澄清的中置信任务，走本地快路径；只有低置信或 `unknown` 输入在配置 DeepSeek 后升级到 LLM Function Call。分析页会提前预热 Agent API；单个智能步骤超过 5.5 秒时自动重试本地模式，未配置、超时或失败时同样自动回退。用户可在设置中切换并持久保持纯本地分析。`test:e2e:agent` 通过真实 Next.js HTTP 路由验证单城市迁居识别、多轮补参、系统自解释、进程内 MCP 和只读迁居候选，但默认城市数据提供方仍是合成演示实现，不等同于真实城市市场数据。HTTP 时延只作为本机回归基线，不是生产 SLA；主动反馈没有形成可审计样本前，不得宣称用户满意度改善。离线 E2E 依赖最新生产构建，请先运行 `pnpm build`。

规划助手会在浏览器本地保存最近 20 条任务 Trace，统计整轮端到端 P50/P95、降级、追问和失败/超时，并允许用户对回答标记有用/无用及负向原因。所有数字都显示样本量；这些本地小样本只用于调试和迭代，不代表线上 SLA、总体满意度或业务收益。

## 技术与许可

项目基于 Next.js 16、React 19 和 TypeScript，长期规划由本地计算逻辑处理，浏览器 IndexedDB 保存账本数据。代码包含 ShipAny 模板；其 [LICENSE](./LICENSE) 限制公开再分发源码。分享或发布仓库前，请确认仓库可见性与授权范围。
