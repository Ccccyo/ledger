# P3：交互升级与规划 Agent 开发设计

> 版本：v1.1  
> 日期：2026-10-14  
> 状态：当前 UI 实现基线  
> 原则：不重做现有产品，不删除现有能力，不修改确定性计算口径

## 0. v1.1 最终 UI 决策

本节优先于文档后续尚未逐段更新的 v1.0 界面描述：

- 工作台为“规划／分析”两个一级页面；年度账本不再作为独立标签，但底层年度数据继续作为快照和图表的可审计来源。
- 规划页在桌面端为双栏：左侧编辑／选择，右侧独立滚动的实时报告。
- 分析页不显示额外页面标题或重复结论卡；左侧为完整报告，右侧为带强调边框和阴影的规划助手。
- 规划助手是分析页常驻右栏，不是 Drawer；接入 Agent 后仍需遵守“计算器给数字，Agent 做解释，修改必须确认”。
- 长期趋势图最多展示 6 个来自用户计划的人生大事，按年份聚合；不将系统风险节点伪装成用户事件。

## 1. 目标

本阶段在现有 Landing Page 和 `/plan` 工作台上完成三项升级：

1. 用“年度快照 + 可拖动年龄游标”替代概览首屏一次铺开全部结果的阅读方式。
2. 把现有时间轴事件升级为可识别、可跳转的里程碑节点，并与概览、规划、年度账本联动。
3. 在工作台内增加上下文规划 Agent。Agent 负责解释和提出受控试算，不负责计算正式金额，也不能未经确认修改计划。

产品最终交互链路：

```text
Landing 快速估算
  → 进入现有 /plan 工作台
  → 概览默认定位一个关键年份
  → 拖动年龄查看单年资金流
  → 点击里程碑跳到规划字段或年度详情
  → 查看数字化建议或打开 Agent
  → 生成受控 PlanPatch
  → 本地确定性试算
  → 用户确认后写入正式计划
```

## 2. 范围与非目标

### 2.1 本阶段修改

- Landing 结果区增加简化趋势图，不改变现有七项输入和交接逻辑。
- 概览增加年度快照、年度资金流图和年龄游标。
- 现有时间轴升级为里程碑游标，不新增里程碑一级页面。
- 现有规划表单增加事件图标和紧凑里程碑卡片，不重排整个编辑器。
- 年度账本增加里程碑标记和“在概览中查看／解释这一年”。
- 增加账本专用 Agent Drawer 和账本专用 API。

### 2.2 明确不做

- 不新增一级用户路由；继续使用 `/` 和 `/plan`。
- 不删除“概览／规划／年度账本”三个工作台标签。
- 不修改 P1 月度计算公式和金额口径。
- 不把桑基图结果保存到计划；它是年度账本的只读视图。
- 不把“压力期”写入正式结果，除非未来有独立定义和测试。
- 不直接复用通用 `/chat` 页面作为产品入口。
- 不在未完成时显示 Agent 灰色按钮或“即将上线”。
- 不在本阶段接入城市房价、租金和养老金实时 API。
- 不开发多 Agent 导航、模型选择器、聊天积分或聊天历史页面。
- 不要求登录；计划继续保存在本地 IndexedDB。

## 3. 现有能力复用

| 目标能力 | 已有实现 | 本阶段处理 |
| --- | --- | --- |
| Landing 计算 | `personal-baseline-form.tsx` | 保留输入与提交，只扩展结果视图 |
| Landing 结果 | `personal-baseline-result.tsx` | 增加只读迷你趋势图 |
| 年度数据 | `MonthlyCalculationResult.annual` | 作为年度快照唯一数据源 |
| 时间轴事件 | `analysis/life-timeline.ts` | 扩展为展示型里程碑模型 |
| 长期图表 | `overview/plan-charts.tsx` | 保留，放入“长期趋势”视图 |
| 阶段分析 | `life-stage-expenses.tsx`、`scenario-chart.tsx` | 保留，不进入年度快照首屏 |
| 确定性试算 | `simulate-action.ts` | 继续作为 Agent 试算唯一入口 |
| 修改确认 | `SimulationDrawer`、`applySimulation` | 复用，不允许 Agent 绕过 |
| 右侧面板 | `WorkspaceDrawer` | 复用为 Agent Drawer 容器 |
| Chat 基础 UI | `shared/blocks/chat`、`ai-elements` | 只复用消息、输入、来源组件 |
| 通用 Chat API | `/api/chat` | 不复用业务流程；保持与账本隔离 |

## 4. 总体架构

```text
LifePlan（本地唯一事实来源）
  │
  ├─ calculateMonthlyLifePlan（不修改）
  │      ├─ monthly
  │      ├─ annual
  │      └─ summary
  │
  ├─ AnnualSnapshotAdapter（新增，纯函数）
  │      ├─ 四个年度指标
  │      ├─ 年度资金流节点与连线
  │      └─ 默认关键年份
  │
  ├─ MilestoneAdapter（新增，纯函数）
  │      ├─ 用户计划事件
  │      └─ 系统计算节点
  │
  └─ AgentContextBuilder（新增，最小上下文）
         ├─ 解释问题
         ├─ 结构化 PlanPatch 草案
         └─ 外部数据候选（后续）
```

页面组件不能自行计算金额。金额只来自 `MonthlyCalculationResult` 或 `simulateAction` 的结果。

## 5. 数据与只读视图模型

### 5.1 年度快照

新增纯函数适配层：

```ts
interface AnnualSnapshotViewModel {
  year: number;
  ageStart: number | null;
  ageEnd: number | null;
  phase: 'working' | 'retired' | 'transition';
  incomeCents: number;
  expenseCents: number;
  liquidReturnCents: number;
  annualAvailableChangeCents: number;
  closingAvailableCents: number;
  closingNetWorthCents: number;
  minimumAvailableCents: number;
  flow: AnnualFlowDiagram;
}

interface AnnualFlowDiagram {
  nodes: Array<{
    id: string;
    side: 'source' | 'center' | 'use';
    category: string;
    label: string;
    amountCents: number;
    tone: 'income' | 'neutral' | 'expense' | 'risk' | 'surplus';
  }>;
  links: Array<{
    source: string;
    target: string;
    amountCents: number;
  }>;
  sourceTotalCents: number;
  useTotalCents: number;
}
```

适配规则：

1. 收入来源使用 `incomeByCategory`。
2. 流动资产收益作为“资金收益”来源，但不混入工资。
3. 资金去向使用 `expenseByCategory`。
4. 当 `收入 + 流动收益 > 支出` 时，差额进入“年度结余”。
5. 当 `收入 + 流动收益 < 支出` 时：
   - 先用正的年初可用资金补足，显示“动用已有资金”；
   - 超过可用资金的部分显示“新增资金缺口”。
6. 小于该侧总额 3% 的分类默认合并为“其他”，精确表格仍保留原分类。
7. `sourceTotalCents` 必须严格等于 `useTotalCents`，否则适配器抛出开发错误。
8. 桑基宽度只表达同一年度内部比例，不跨年度比较。

### 5.2 里程碑视图模型

第一阶段不修改 `LifePlan` Schema。里程碑由现有计划与结果推导：

```ts
type MilestoneKind =
  | 'start'
  | 'career'
  | 'partner'
  | 'child'
  | 'housing'
  | 'parents'
  | 'retirement'
  | 'loan-end'
  | 'custom'
  | 'first-gap'
  | 'minimum-cash'
  | 'end';

interface MilestoneMarker {
  id: string;
  month: number;
  year: number;
  age: number | null;
  label: string;
  kind: MilestoneKind;
  source: 'user' | 'system';
  targetSection?: string;
  prominence: number;
  status: 'past' | 'current' | 'future' | 'risk';
}
```

来源规则：

- `lifeTimeline(plan)` 生成用户计划事件、退休、房贷结束和规划终点。
- `result.summary.firstGapMonth` 生成“首次资金缺口”。
- `extractPlanFacts(...).minimumMonth` 生成“最低可用资金”。
- 同月事件在视觉上聚合，但保持独立 ID 和跳转目标。
- 主轴默认最多强调七个节点；其他节点放在“全部里程碑”中。
- 用户事件使用圆形图标；系统结果使用菱形；风险同时带文字，不只依靠颜色。

“新工作／结婚／换城市”等更细事件类型暂时根据现有阶段和名称显示通用图标。未来若需要稳定区分，再增加可选 `milestoneKind` 元数据，不在本阶段迁移计划 Schema。

### 5.3 默认选中年份

新增纯函数 `selectInitialSnapshotYear(result)`：

1. 有首次缺口：选择首次缺口所在年。
2. 无首次缺口：选择全期最低可用资金所在年。
3. 若最低点等于起点且长期稳定：选择退休年。
4. 返回用户上次选择的年份时，只在该年份仍属于当前规划范围时使用。

用户上次选择只保存为界面偏好，不写入 `LifePlan`。

## 6. 页面改动设计

### 6.1 Landing Page

保持现有表单结构、字段、校验、提交和 `sessionStorage` 交接逻辑。

修改 `PersonalBaselineResult`：

- 保留现有结论、首次缺口、终点可用资金和继续按钮。
- 在两项指标与说明之间增加 `BaselineMiniChart`。
- 图表只显示年末可用资金趋势、退休线和首次缺口点。
- 不显示净资产，因为快速估算只包含可用资产。
- 图表提供一句文本摘要和可访问数据表。
- 输入发生变化后继续沿用现有“结果需要重新计算”状态，不自动把未提交输入写入正式结果。

不在 Landing 展示 Agent。用户尚未形成正式账本，Agent 缺乏可靠上下文。

### 6.2 概览

保留当前结论卡，但把首屏结构调整为：

```text
结果结论与三个现有指标
  ↓
年度快照 / 长期趋势（局部视图切换，不进入 URL）
  ↓
系统分析与数字化建议
  ↓
数据完整度
```

默认选择“年度快照”：

- `SnapshotMetrics`：年度收入、年度支出、年度结余、年末可用资金。
- `AnnualFlowSankey`：当前年份资金来源与去向。
- `MilestoneScrubber`：年龄游标和关键里程碑。
- “这一年怎么改善”入口：使用现有 `generateActions` 和 `SimulationDrawer`。
- “问问账本”入口：打开 Agent Drawer，并携带当前年份上下文。

“长期趋势”视图复用现有组件：

- `PlanCharts`
- `LifeStageExpenses`
- `ScenarioChart`

`LifeTrajectory` 和完整时间节点仍保留，但移到年度快照下方或“全部里程碑”展开区，不重复绘制第二条主时间轴。

### 6.3 年龄游标

使用原生 `input[type="range"]` 作为可访问控制，视觉上覆盖自定义圆形手柄：

- `min` 为第一条年度记录的年份。
- `max` 为最后一条年度记录的年份。
- `step=1`。
- 左右方向键逐年移动；PageUp/PageDown 移动五年；Home/End 到首尾。
- 点击里程碑直接更新选择年份。
- 指针拖动时即时更新四个数字，桑基图使用 150～250ms 过渡。
- `prefers-reduced-motion` 下取消图形过渡。
- 同一年多个节点显示堆叠图标或“+N”。
- 变化通过 `aria-live="polite"` 只播报“2046 年，58 岁，年度结余负 5.8 万元”，不朗读整张图。

### 6.4 规划

不重排 `PlanView` 和 `StageEditor`。

小范围修改：

- 为已有事件行增加对应里程碑图标和“年龄／年月”。
- 在人生事件区增加紧凑事件模板入口；模板仍调用现有 `saveStageEvent`。
- 模板首批只包含现有数据结构能够准确表达的事件：一次性收入、一次性支出、持续收入、持续支出、孩子、父母、住房、自定义事件。
- “换城市”不在此阶段伪装为单笔事件；等城市方案的数据结构确定后单独加入。
- 保存后继续使用现有 `PlanChangeFeedback` 展示前后差异。

### 6.5 年度账本

保持表格和移动端列表结构。

新增：

- 根据年份显示最多两个里程碑图标；更多显示“+N”。
- 年度详情抽屉增加“在概览中查看”。
- 通过安全 URL 参数跳转：`/plan?tab=overview&year=2046`。
- 增加“解释这一年”，打开 Agent Drawer 并附带该年上下文。
- `year` 超出当前计划范围时忽略并使用默认年份。

## 7. Agent 产品与技术设计

### 7.1 用户界面

不新增一级页面。入口位于：

- 工作台顶部“问问账本”。
- 概览当前年度的“解释这个结果”。
- 数字化建议中的“为什么推荐这个调整”。
- 年度账本详情的“解释这一年”。

桌面使用现有 `WorkspaceDrawer`，移动端自然占满宽度。Drawer 关闭后焦点返回原入口，当前标签和选择年份不变。

Agent UI 不显示模型选择、推理开关、积分或通用联网开关。用户只看到一个“账本助手”。

### 7.2 首批能力

按风险由低到高分三步开放：

1. **解释模式**：解释当前结论、年份、里程碑和系统分析，不修改数据。
2. **试算模式**：生成受控 `PlanPatch` 草案，在本地调用 `simulateAction`，展示前后数字。
3. **应用模式**：用户点击确认后，复用 `applySimulation` 写入计划并自动保存。

外部数据查询属于后续数据 Agent，不与首批规划 Agent 同时发布。

### 7.3 Agent 上下文

不向模型发送完整 IndexedDB 记录或计算 trace。客户端按入口生成最小上下文：

```ts
interface LifeLedgerAgentContext {
  schemaVersion: '1';
  locale: 'zh-CN' | 'en';
  planHash: string;
  view: 'overview' | 'plan' | 'ledger';
  focus?: {
    year?: number;
    month?: number;
    milestoneId?: string;
    section?: string;
  };
  summary: {
    firstGapMonth: number | null;
    minimumAvailableCents: number;
    endingAvailableCents: number;
    retirementMonth: number;
  };
  selectedYear?: {
    incomeCents: number;
    expenseCents: number;
    liquidReturnCents: number;
    closingAvailableCents: number;
    closingNetWorthCents: number;
    incomeByCategory: Record<string, number>;
    expenseByCategory: Record<string, number>;
  };
  allowedTargets: Array<{
    id: string;
    kind: 'cash-flow' | 'asset' | 'retirement';
    label: string;
  }>;
  activeInsights: Array<{
    ruleId: string;
    severity: string;
    target: string;
  }>;
}
```

默认不发送姓名、计划名称、自由备注、原始 trace 和无关年份。首次调用前显示明确说明：哪些账本数据会发送到 AI 服务。

### 7.4 结构化建议

模型不能返回任意 JavaScript，也不能直接返回完整 `LifePlan`。只接受白名单草案：

```ts
type AgentPlanPatchDraft =
  | {
      type: 'shift-cash-flow';
      cashFlowId: string;
      monthDelta: number;
      rationale: string;
    }
  | {
      type: 'change-cash-flow-amount';
      cashFlowId: string;
      amountCents: number;
      rationale: string;
    }
  | {
      type: 'change-retirement-month';
      retirementMonth: number;
      rationale: string;
    }
  | {
      type: 'change-liquid-opening-balance';
      assetId: string;
      openingBalanceCents: number;
      rationale: string;
    };
```

校验顺序：

```text
模型结构化输出
  → Zod Schema
  → ID 是否属于 allowedTargets
  → 数值和月份边界
  → applyPlanPatch
  → validateLifePlan
  → calculateMonthlyLifePlan
  → 展示 ResultChange
  → 用户确认
  → applySimulation
```

任何一步失败都只产生解释性错误，不写入正式计划。

### 7.5 API 边界

新增账本专用接口：

```text
POST /api/life-ledger/assistant
```

请求包含：

- 当前用户消息。
- 最近有限轮对话。
- `LifeLedgerAgentContext`。
- 允许的响应能力：`explain` 或 `propose_patch`。

响应采用流式文本，并允许返回结构化建议卡。服务端不读取浏览器 IndexedDB，也不持有修改权限。

实现要求：

- 使用服务端 API Key，绝不下发浏览器。
- 使用 DeepSeek Responses API；密钥、模型与超时均由服务端环境变量配置。
- `store: false`，不依赖服务端保存对话状态。
- 使用 SSE 流式返回，提高首字响应速度。
- 工具／函数参数使用严格 JSON Schema。
- 设置请求体大小、输出 token、超时和每会话频率限制。
- 生产环境记录错误类型和耗时，不记录原始财务上下文。
- 模型名称由服务端环境变量决定，界面不提供选择器。

OpenAI 官方文档依据：

- Responses API 支持状态式交互和函数调用：<https://developers.openai.com/api/reference/responses/overview>
- 函数调用由应用执行工具并回传结果：<https://developers.openai.com/api/docs/guides/function-calling>
- Responses API 支持 SSE 流式输出：<https://developers.openai.com/api/docs/guides/streaming-responses>
- `store: false` 可关闭 Response 对象的默认存储：<https://developers.openai.com/api/docs/guides/conversation-state>

### 7.6 与现有通用 Chat 的关系

现有 `/api/chat` 依赖：

- 登录用户；
- 数据库 Chat 记录；
- OpenRouter 配置；
- 用户模型选择。

这些条件与当前“一份本地账本、无需登录”的产品边界不一致，因此不能直接把通用 Chat 页面嵌入工作台。

可复用：

- `useChat` 和流式 transport 组织方式。
- `Conversation`、`Message`、`Response`、`Sources`、`PromptInput`。
- 加载、重试、复制和错误展示。

不可复用：

- 通用聊天路由。
- 模型选择器和 reasoning 开关。
- Chat 数据库和聊天历史页面。
- 通用附件、图片、音乐和视频能力。

## 8. 建议的文件改动

### 8.1 新增

```text
src/features/life-ledger/analysis/annual-snapshot.ts
src/features/life-ledger/analysis/annual-snapshot.test.ts
src/features/life-ledger/analysis/milestones.ts
src/features/life-ledger/analysis/milestones.test.ts

src/features/life-ledger/landing/baseline-mini-chart.tsx

src/features/life-ledger/workspace/overview/annual-snapshot-explorer.tsx
src/features/life-ledger/workspace/overview/annual-flow-sankey.tsx
src/features/life-ledger/workspace/overview/milestone-scrubber.tsx
src/features/life-ledger/workspace/overview/snapshot-metrics.tsx

src/features/life-ledger/agent/agent-context.ts
src/features/life-ledger/agent/agent-context.test.ts
src/features/life-ledger/agent/agent-proposal.ts
src/features/life-ledger/agent/agent-proposal.test.ts
src/features/life-ledger/agent/agent-drawer.tsx
src/features/life-ledger/agent/agent-messages.tsx
src/features/life-ledger/agent/agent-input.tsx

src/app/api/life-ledger/assistant/route.ts
```

### 8.2 修改

```text
src/features/life-ledger/landing/personal-baseline-result.tsx
src/features/life-ledger/workspace/plan-workspace-client.tsx
src/features/life-ledger/workspace/overview/life-timeline.tsx
src/features/life-ledger/workspace/ledger/ledger-view.tsx
src/features/life-ledger/workspace/plan/stage-editor.tsx
src/features/life-ledger/workspace/components/workspace-drawer.tsx
src/features/life-ledger/workspace/navigation.ts
src/config/locale/messages/zh/pages/plans.json
src/config/locale/messages/en/pages/plans.json
```

如直接使用 OpenAI provider，需要新增与当前 AI SDK 主版本兼容的 provider 依赖；具体版本在实现时以锁文件和官方 provider 文档验证，不在设计文档中硬编码。

## 9. 状态管理

年度快照属于界面状态，不加入全局 reducer：

```ts
type OverviewMode = 'snapshot' | 'trend';

interface OverviewUiState {
  mode: OverviewMode;
  selectedYear: number;
  agentOpen: boolean;
  agentContext: LifeLedgerAgentContext | null;
}
```

以下状态继续由 `WorkspaceProvider` 管理：

- 正式 `LifePlan`。
- 当前计算结果。
- 保存状态。
- `pendingChange`。
- `resultChange`。
- 应用和撤销试算。

Agent 不能直接 dispatch `plan/update`。只有经过本地校验和用户确认的候选方案，才能调用已有 `applySimulation`。

## 10. 错误与边界状态

### 年度快照

- 没有年度数据：回退到当前摘要，不渲染游标。
- 年龄未知：显示年份，不编造年龄。
- 分类全部为零：显示“这一年没有记录收入或支出”，不渲染空桑基。
- 同年事件过多：主轴聚合，完整列表保留。
- 一次性大额支出压缩其他流：保持真实比例，并在精确表格中可读。

### Agent

- 未配置 API：入口完全隐藏。
- 网络失败：保留用户输入，允许重试，不影响手动功能。
- 输出无法通过 Schema：显示“未能生成安全试算”，不尝试修补后静默应用。
- 上下文已过期：计划哈希变化后作废旧建议。
- 计算失败：保留上一次有效结果。
- 用户拒绝发送账本数据：关闭 Agent，其他功能正常使用。
- 外部事实无来源：不得进入正式输入。

## 11. 测试设计

### 11.1 单元测试

年度快照：

- 每年资金流 `sourceTotal === useTotal`。
- 正结余进入“年度结余”。
- 负结余先区分动用存量和新增缺口。
- 3% 以下分类正确合并，精确总额不丢失。
- 默认年份按首次缺口、最低点、退休的顺序选择。

里程碑：

- 用户事件和系统节点按月份稳定排序。
- 同月节点正确聚合。
- 首次缺口和最低点不重复创建。
- 没有出生月份时不生成虚假年龄。
- 目标 section 与现有规划导航一致。

Agent：

- 上下文不包含姓名和无关原始数据。
- 不在 `allowedTargets` 的 ID 被拒绝。
- 越界月份、负金额和无效 patch 被拒绝。
- 计划哈希变化后旧建议失效。
- Agent 输出不能绕过 `validateLifePlan` 和 `simulateAction`。

### 11.2 组件与无障碍测试

- Range 键盘操作更新年度快照。
- 点击里程碑选择正确年份。
- 年度变化有简短 `aria-live` 提示。
- 桑基有文本摘要和表格替代。
- Drawer 关闭后焦点返回入口。
- 200% 缩放不出现页面级横向滚动。
- 移动端 Agent 输入框不被软键盘和底部安全区遮挡。

### 11.3 E2E

1. Landing 提交后迷你图与摘要来自同一结果。
2. 进入工作台后默认定位首次缺口或最低点年份。
3. 从账本点击年份可回到概览对应快照。
4. 从里程碑跳到正确规划 section。
5. Agent 解释不会改变计划哈希。
6. Agent 试算展示前后差异但不自动应用。
7. 用户确认后结果更新，可执行一次撤销。
8. Agent API 失败时手动编辑、计算、保存和导出仍正常。

## 12. 性能与隐私要求

- 年度快照适配器使用 `useMemo`，依赖 `result.inputHash`。
- 拖动时不重跑月度计算，只切换已有年度结果。
- 桑基只渲染一个年度，节点数量控制在 12 个以内。
- 长期图表保持现有懒加载或按视图挂载，不与桑基同时持续更新。
- Agent 请求默认只带当前摘要、焦点年度和允许目标。
- 日志不得包含收入、资产、年龄、家庭成员和完整消息正文。
- 分析埋点只能记录入口、成功／失败和耗时等非财务事件。
- 首次启用 Agent 必须说明数据会离开本地浏览器。

## 13. 开发阶段

### P3-A：只读适配层

- `AnnualSnapshotAdapter`。
- `MilestoneAdapter`。
- 默认年份选择。
- 全部单元测试。

放行条件：所有图形数据都能追溯到年度账本，且资金流守恒。

### P3-B：Landing 与概览交互

- Landing 迷你图。
- 年度快照、桑基图和年龄游标。
- 年度快照／长期趋势切换。
- 桌面与移动端适配。

放行条件：不接入 Agent 时，用户已能通过拖动理解单年数据。

### P3-C：里程碑联动

- 时间轴图标升级。
- 规划事件卡片增强。
- 年度账本标记。
- `year` 安全 URL 状态与跨视图跳转。

放行条件：概览、规划、账本能够围绕同一里程碑互相定位。

### P3-D：Agent 解释模式

- Agent Drawer。
- 最小上下文和首次隐私确认。
- 专用 API、流式回答、错误恢复。
- 仅解释，不开放修改工具。

放行条件：Agent 不可用时不影响任何现有功能；解释中的数字与传入上下文一致。

### P3-E：Agent 受控试算

- 结构化 patch 草案。
- 白名单、Zod、目标 ID 和边界校验。
- 本地 `simulateAction`。
- 前后图表与数字比较。
- 用户确认应用和撤销。

放行条件：零静默修改；正式金额全部来自确定性计算引擎。

### P4：外部数据 Agent（后续）

- 城市房价和租金候选值。
- 来源、发布日期、地区和样本口径。
- 用户确认后才写入计划。
- 独立数据版本和审核机制。

P4 不阻塞 P3 发布。

## 14. 验收标准

本阶段完成必须同时满足：

- Landing 和内部三个标签仍可按原流程使用。
- 所有现有能力仍存在，没有因首屏简化被删除。
- 概览默认只突出一个年度，而不是一次铺开全部图表。
- 用户可拖动年龄并通过里程碑跳转。
- 年度快照与年度账本金额完全一致。
- 所有建议以首次缺口、最低资金和终点资金的前后数字呈现。
- Agent 不计算正式金额、不静默修改、不依赖独立聊天页面。
- API 故障、未配置和拒绝授权时，手动产品完整可用。
- 中文、英文、桌面、移动端和键盘操作均通过验收。

