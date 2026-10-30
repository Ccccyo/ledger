# 一生账本（Life Ledger）

一生账本是一款面向长期人生规划的本地优先财务工具。它把收入、日常支出、住房、迁居、育儿、投资和退休等事件放进同一条时间轴，帮助用户理解不同选择对未来现金流和资产余额的影响。

项目不是记账流水工具，也不替代专业的投资、税务或法律意见。它更关注“如果做出某个长期决定，未来可能发生什么”，并通过可解释的计算结果与 Agent 辅助分析支持方案比较。

## 项目背景

长期财务决策通常分散在不同表格、计算器和聊天记录中，难以形成统一、可持续更新的计划。买房、换城市、收入增长、子女支出和退休安排之间又相互影响，单点计算容易忽略时间和现金流的连锁变化。

一生账本希望解决三个问题：

1. 把个人当前情况与未来事件组织成结构化计划。
2. 用一致的计算口径生成逐年现金流、资产变化和风险提示。
3. 让 Agent 能读取、解释和试算计划，但不能在未经确认的情况下直接修改正式数据。

## 核心功能

### 长期账本

- 建立个人与家庭成员的收入、支出、资产和负债基线。
- 按月计算、按年汇总长期现金流与资金余额。
- 展示人生阶段、关键事件、年度快照和资金缺口。
- 支持通胀、收入增长、投资收益和退休等长期假设。

### 人生计划

- 规划职业与工资增长。
- 规划租房、买房、首付、贷款和住房支出。
- 规划迁居、生活成本、育儿、家庭成员与退休安排。
- 创建多种投资情景，并比较不同风险与收益假设。
- 修改前展示候选方案和影响，确认后才写入正式计划。

### 方案分析

- 比较不同人生方案的年度结余、资产曲线和关键年份。
- 识别现金流转负、资金不足和重大支出集中的阶段。
- 将计算依据、数据来源和待确认项与结果一起展示。
- 支持离线使用与浏览器本地恢复。

### 规划 Agent

- 查询当前计划、解释指标并回答规划问题。
- 调用确定性计算工具执行买房、迁居、退休等试算。
- 识别缺失信息并通过追问补齐参数。
- 支持短期会话记忆、任务工作记忆、Skill 路由和工具调用。
- 可接入 DeepSeek；未配置模型时自动使用本地确定性能力。
- Agent 提议的修改必须经过用户确认，不能绕过确认直接写入计划。

业务 Skills 和工具边界见 [skills.md](./skills.md)。

## 在线使用

当前 Vercel 部署：

<https://ledger-lake-seven.vercel.app>

首次进入后创建或编辑计划即可。核心规划数据保存在当前浏览器中；更换浏览器、使用无痕模式或清除网站数据后，本地记录可能无法恢复，请定期导出备份。

## 本地运行

### 环境要求

- Node.js 20 或更高版本
- Corepack
- pnpm 9（项目已在 `package.json` 中固定版本）

### 启动开发环境

```bash
git clone git@github.com:Ccccyo/ledger.git
cd ledger
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm dev
```

打开 <http://localhost:3000>。

核心账本、试算和本地 Agent 不要求数据库。若要启用 DeepSeek Agent，在 `.env.local` 中配置：

```bash
DEEPSEEK_API_KEY="your-api-key"
DEEPSEEK_MODEL="deepseek-flash"
```

不要把 `.env.local`、API Key、数据库连接或其他密钥提交到 Git。

### 常用命令

```bash
pnpm dev               # 开发服务器
pnpm build             # 生产构建
pnpm start             # 启动生产构建
pnpm test:calculation  # 计算与领域测试
pnpm test:agent        # Agent 与工具测试
pnpm eval:agent        # Agent 统一评测入口
pnpm test:e2e          # 关键用户旅程测试
pnpm lint              # 代码检查
```

## 部署到 Vercel

1. 将仓库导入 Vercel，Framework 选择 Next.js。
2. 保留仓库中的 `vercel.json`，安装与构建命令会自动读取。
3. 在 Vercel 项目的 Environment Variables 中添加生产变量。
4. 部署完成后，将正式地址填写为 `NEXT_PUBLIC_APP_URL` 并重新部署。

Agent 所需的最小生产配置：

```text
DEEPSEEK_API_KEY=<Secret>
DEEPSEEK_MODEL=deepseek-flash
AGENT_RATE_LIMIT_INTERVAL_MS=2500
NEXT_PUBLIC_APP_URL=https://your-project.vercel.app
```

`DEEPSEEK_API_KEY` 应设置为 Secret，只在服务端读取，不应使用 `NEXT_PUBLIC_` 前缀。公开部署会消耗模型额度，建议同时在模型服务商控制台设置余额提醒或支出限制。

连接 GitHub 后，每次向 `main` 分支推送代码都会触发新的 Vercel 部署。Vercel 会保留历史版本，可在控制台查看、回滚或重新部署。

## 数据与权限边界

### 用户数据

- 核心人生计划与 Agent 本地状态默认保存在浏览器 IndexedDB 中。
- 当前版本没有自动把完整账本同步到云数据库。
- 用户主动向 Agent 提问时，回答所需的精简计划上下文会发送到服务端；配置 DeepSeek 后，该上下文可能继续发送给模型服务商处理。
- 清除浏览器数据可能删除本地计划，使用者应自行维护导出备份。

### Agent 权限

- Agent 可以读取当前计划、执行试算、生成解释和提出候选修改。
- Agent 不能绕过确认直接新增、删除或覆盖正式计划。
- 外部城市数据只能作为带来源的候选值，确认前不进入正式计算。
- API Key 只保存在服务端环境变量中，不会发送到浏览器。
- 生产接口包含基础频率限制，但这不能替代用户身份验证、网关限流或模型账户的支出上限。

### 账户与数据库

- 核心账本无需登录即可使用，也无需配置 `DATABASE_URL`。
- 仓库中仍保留可选的账户、数据库和第三方服务接口；只有启用相应功能时才需要配置数据库、认证和服务端权限。
- 若未来增加多人协作或云端同步，应在上线前补充身份认证、数据隔离、访问审计、备份与隐私政策。

### 源代码使用权限

本仓库包含受第三方许可证约束的基础代码。可以在许可证允许的范围内开发和部署应用，但不应将受限制的基础代码作为独立模板转售、公开再分发或共享访问凭据。具体权利与限制以仓库中的 [LICENSE](./LICENSE) 为准；将仓库设为公开或向团队外分发源码前，请先确认授权范围。

## 技术架构

- Next.js 16、React 19、TypeScript
- pnpm workspace
- 浏览器 IndexedDB 本地持久化
- 服务端 Route Handlers 承载 Agent 与城市成本接口
- DeepSeek 可选模型能力，本地确定性路由作为降级方案
- 自定义离线壳与生产构建流程
- Vercel 生产部署

主要目录：

```text
src/features/life-ledger/   账本领域、计算、存储、分析和工作区
src/app/api/life-ledger/    Agent 与城市成本服务端接口
agent-skills/               Agent Skills 定义与评测样例
scripts/                    构建、测试、E2E 与 Agent 评测脚本
docs/                       产品说明、测试报告与评测证据
```

## 测试说明

Agent 测试覆盖确定性路由、模型 Function Call 模拟、权限边界、追问补参、城市成本候选、工作记忆、指标与降级策略。模拟响应不等同于真实模型联调；配置 `DEEPSEEK_API_KEY` 后仍应在预览环境完成真实接口验证。

计算结果用于规划参考，不构成投资建议。涉及税务、法律、保险或重大投资决策时，应结合所在地规则并咨询专业人士。
