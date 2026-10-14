# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary users are individuals and families who want to understand whether their current income, spending, savings, assets, debts and retirement plans can support their long-term life plan. They need an understandable planning tool rather than professional trading or investment advice.

## Product Purpose

一生账本 is a local-first family long-term cash-flow planner. It converts a small starting estimate into a month-by-month plan, annual ledger and traceable explanation. Success means a user can create, understand, modify, save and audit one plan without AI assistance.

## Positioning

The product keeps one canonical plan model and one deterministic monthly calculation core. Summary amounts can be progressively split into details without double-counting, and every material result remains traceable to an input, source and calculation version.

## Operating Context

Users begin with seven values on the Landing Page, including a starting available-assets estimate, then continue in a three-view workspace: Overview for conclusions, Plan for inputs and breakdowns, and Ledger for annual verification. The first release supports one local plan in the current browser.

## Capabilities and Constraints

- Formal plan data uses `LifePlan 2.0.0` and integer cents, month indexes and basis points.
- Formal results use the deterministic P1 monthly calculation core.
- Available cash, debt and net worth remain separate.
- Formal plans use IndexedDB; sessionStorage is temporary handoff; localStorage is limited to lightweight preferences and one-time legacy migration.
- Financial and family data never enters URLs, page titles or analytics events.
- P2 excludes AI agents, cloud sync, accounts, pricing and automated pension or policy forecasts.
- The first release supports CNY and purchasing power in today's money.

## Brand Commitments

- Product name: 一生账本 / Life Ledger.
- Voice: calm, conditional, plain-spoken and trustworthy; conclusions begin with the equivalent of “according to the current inputs”.
- Existing visual identity: neutral surfaces with a restrained green primary color and amber for estimates, pending confirmation and risk.
- No exaggerated certainty, accuracy percentages or fear-based deficit language.

## Evidence on Hand

- Product and page baseline: `docs/一生账本_产品开发与页面设计说明.md`.
- P0/P1 implementation contract: `docs/P0-P1_数据与计算内核实现说明.md`.
- P2 development design: `docs/P2_最小可用产品开发设计说明.md`.
- P2.1 real user journey, deterministic analysis and action simulation: `docs/P2.1_真实用户动线与系统分析开发设计说明.md`.
- P2.1 engineering implementation order, file plan and release gates: `docs/P2.1_工程实施开发文档.md`.
- P2.1 phase 0–2 execution records: `docs/P2.1_阶段0执行记录.md`, `docs/P2.1_阶段1执行记录.md` and `docs/P2.1_阶段2执行记录.md`.
- Deterministic P0/P1 source and automated test fixtures under `src/features/life-ledger/`.
- No testimonials, customer logos, external benchmarks or commercial claims are available and none may be fabricated.

## Product Principles

- Define data first, validate calculation second, then present conclusions.
- Never count the same income or expense twice.
- Keep inputs, estimates, external references and calculated results visibly distinct.
- Preserve the last valid result when editing, calculation or saving fails.
- Make local storage boundaries and assumptions explicit.

## Accessibility & Inclusion

The product must support keyboard navigation, visible focus, screen-reader status updates, reduced motion, chart table alternatives, mobile layouts and WCAG AA contrast for text and controls.
