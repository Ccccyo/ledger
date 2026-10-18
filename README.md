# 一生账本（Life Ledger）

一个面向长期生活规划的账本：从当前收支与资产出发，按年查看现金流、资金缺口和退休后的变化，并试算人生事件或计划调整的影响。

## 主要功能

- 建立个人基线，查看逐年账本、资金余额和关键节点。
- 规划收入、支出、住房、迁居、育儿、投资与退休等变化，比较不同方案。
- 使用规划助手查询计划、调用试算工具；修改计划前需要用户确认。可用工具见 [skills.md](./skills.md)。
- 在浏览器本地保存计划与助手状态；核心规划无需另建后端数据库。请定期导出备份，并注意清除浏览器数据会影响本地记录。

## 本地运行

需要 Node.js 20 或更高版本，以及 pnpm。在项目根目录执行：

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

然后打开 <http://localhost:3000>。核心账本功能可不配置数据库；如需使用依赖账户或服务端数据的模板功能，应按 `.env.example` 补齐相应配置。

如需体验模型自主选择 Skill，在 `.env.local` 中填写 `DEEPSEEK_API_KEY`。未配置时，规划助手使用本地回退回答。不要把真实密钥提交到 Git。

## 验证

```bash
pnpm test:calculation
pnpm eval:agent:skills
pnpm build
```

其中 Agent 评测使用模拟模型响应，不等同于真实模型接口的端到端验证。

## 技术与许可

项目基于 Next.js 16、React 19 和 TypeScript，长期规划由本地计算逻辑处理，浏览器 IndexedDB 保存账本数据。代码包含 ShipAny 模板；其 [LICENSE](./LICENSE) 限制公开再分发源码。分享或发布仓库前，请确认仓库可见性与授权范围。
