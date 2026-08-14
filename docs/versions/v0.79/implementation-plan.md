---
document_type: implementation-plan
version: v0.79
authority: implementation-plan-and-acceptance
status: in_progress
last_updated: 2026-08-14
---

# v0.79 实施与验收计划

## Checkpoint 0：版本、预算与长期边界

- [x] 从最新 `origin/main@c2207bd812f60e736812acdfb68d4bcc060aaa10` 创建隔离 worktree
  `codex/v0.79-camp-open-performance`；
- [x] 将完成的 v0.77 冻结为 historical，建立唯一 current v0.79 概览与实施计划；
- [x] 确认 `camps.*` 打开/读取能力只属于 Desktop typed IPC / Core surface，不进入 Agent Built-in CLI；
- [x] 确认继续遵守 ADR-0058：Default Lead reconcile 在权威打开投影之前完成，snapshot/read 本身保持纯读；
- [x] 记录现有点击进入、启动恢复、全量 `CampSnapshot`、串行 Core queue 与 Renderer 首屏阻塞事实；
- [ ] 用可复现 fixtures 冻结 click-to-meaningful-paint、startup-restore、background-complete 的 p50/p95
  预算、允许方差、payload hard limit、测试硬件与采样协议；
- [ ] 冻结 Desktop open projection Contract：schema、字段、coverage、window、cursor、排序、错误、
  high-water、兼容与 reset 语义；
- [ ] 复核 ADR / Contract / Architecture / UI 影响；需要长期文档时先更新权威文件与路由，再开始对应实现；
- [ ] 合入前基于届时 canonical predecessor 重放版本切换；若 v0.78 已落地主线，更新 v0.77/v0.78/v0.79
  前后链接和跨版本影响，绝不覆盖现有 v0.78 worktree。

## Checkpoint 1：分段测量与基线

- [ ] 定义同一 enter trace ID，并贯穿 Renderer、Electron Main bridge、Core request queue 与 read transaction；
- [ ] 记录 click/restore、Renderer send、Main receive、queue wait、reconcile、query/hydration、serialize、
  Main parse、Renderer receive、state commit、meaningful paint 与后台维护完成；
- [ ] 记录 payload bytes、projection item counts、schema 与 high-water，不记录正文、附件路径、命令、
  模型输出或稳定实体 ID；
- [ ] 建立至少 short、message-heavy、evidence-heavy、action/event-heavy、live-run/pending-approval 五类
  隔离 fixtures；历史规模至少覆盖两个数量级；
- [ ] 输出 before baseline，分别归因 queue、SQLite、serialization/IPC 与 React，不用单一总耗时掩盖瓶颈；
- [ ] 为性能日志增加数据最小化、字段 allowlist 和 production sampling / disable 策略测试。

## Checkpoint 2：进入关键路径止血

- [ ] 新增 Contract 冻结的 Desktop internal enter method，在一次 Core queue 流程中顺序执行幂等
  Default Lead reconcile 与 post-reconcile lightweight projection；
- [ ] 点击进入、Desktop startup restore、通知打开与成员页返回复用同一 enter primitive；
- [ ] 删除 Renderer 中“Promise.all 看似并发、实际依赖串行 queue 顺序”的双请求路径；
- [ ] 在首个有意义 paint 后执行 project navigation restore、current-project persistence、
  `navigation.campViewed` 与 navigation refresh；
- [ ] 所有 foreground/background response 使用 selection generation、Camp ID 与 high-water fence，
  迟到或倒退结果不能覆盖新选择；
- [ ] background failure 保留已打开 Camp、Draft 与滚动位置，在对应 surface 显示可恢复状态；
- [ ] 覆盖 reconcile no-op、Lead changed、no valid Lead、rejected command、快速 A→B→A 切换和 startup
  恢复 tests。

## Checkpoint 3：轻量 Camp open projection

- [ ] 在一个 SQLite transaction 中读取 Camp、成员、非终态 Task 首段、最近消息、当前执行 /
  recovery、pending Approval、最小 delivery facts 与 `throughGlobalSequence`；
- [ ] 为每个有界集合返回 total/omitted、coverage、oldest/newest sequence 与 stable next cursor；
- [ ] recent messages 只 hydrate 当前窗口的 Structured Content / attachment metadata；不得扫描或序列化
  窗口外正文；
- [ ] active execution query 只返回 non-terminal / unresolved state 与首屏需要的摘要，不加载 terminal
  Evidence、Context Manifest、历史 Actions 或完整 Timeline；
- [ ] 用索引与 query plan 证明查询成本由首屏窗口和当前 active state 决定；需要新索引时增加 migration
  与真实升级测试；
- [ ] 更新 Rust DTO/schema、Core route、Electron Main allowlist、preload/shared TypeScript type 与 schema
  fail-closed 检查；
- [ ] 保留 `camps.snapshot` 纯读兼容面，但让普通 open 与 ordinary event refresh 不再调用它；
- [ ] 加入 short/long fixture 的 DTO equality、coverage、pagination handoff、sequence gap 与 payload budget tests。

## Checkpoint 4：按需历史、过程与精确锚点

- [ ] 新增较早 Camp Message 的 keyset page read，冻结请求 high-water，并与最近窗口按 stable ID/sequence
  去重合并；
- [ ] 保留并验证 `camp.messages.around` 的 same-Camp exact anchor，用于通知、reply parent、搜索结果和
  source unavailable；
- [ ] 过程入口先读 Agent/Run summary；只有展开精确 Run 时加载 stage detail，并复用
  `agentRunEvidence.list` / `agentRunEvidence.getContent`；
- [ ] terminal Task、历史 Run/Delivery、Action、Manifest 与 Timeline 分别路由到明确 detail surface；
  没有生产 surface 的数据不得仅为兼容旧 snapshot 而预取；
- [ ] page/detail 请求与 event refresh 共享 high-water / reset 规则，处理新消息插入、Run 终态、删除 /
  tombstone、schema mismatch 与 Core restart；
- [ ] 验证较早消息分页、exact focus、父引用、process Drawer bottom-follow 和完整 Tool output copy 不回归。

## Checkpoint 5：Renderer 渐进状态与渲染成本

- [ ] 用 open projection state 替代普通 Camp surface 对完整 `CampSnapshot` 的依赖，历史/detail state
  独立保存；
- [ ] 首屏先 commit Camp、最近消息、Composer、pending Approval 与 active/recovery state；Inspector /
  process history 使用局部 Loading/Partial/Error；
- [ ] 缓存只保存 schema/high-water 可验证的 recent projection；miss、gap、restart 或 incompatible schema
  重新读取 Core；
- [ ] hidden timeline、world map 和关闭的 Drawer 不预构造全部历史 JSX；只有性能证据证明必要时才引入
  virtualization；
- [ ] Core events 按 Camp/entity 合并 invalidation，选择轻量 refresh 或精确 detail refresh，不逐 event
  拉取完整 snapshot；
- [ ] 保持 Draft、消息滚动、notification focus、Inspector selection、world-map mode 与 keyboard focus；
- [ ] 覆盖 Day/Night、1040×700、1440×920、200% zoom、reduced motion、cache hit/miss、Partial/Error
  与无障碍状态。

## Checkpoint 6：性能验收、文档与发布

- [ ] 在同一隔离 fixture、硬件、build mode 与采样协议上采集 before/after click open 与 startup restore
  p50/p95、各阶段 duration、payload bytes 与 React commit/paint；
- [ ] 证明相同首屏状态下，历史规模相差至少两个数量级时 payload 不增长，open p95 位于 Checkpoint 0
  容差内；
- [ ] 证明 ordinary open/refresh 零 `camps.snapshot` 请求，历史/detail 只由用户动作或精确 invalidation
  触发；
- [ ] 运行受影响 Core tests、Renderer tests、`pnpm typecheck`、`pnpm test`、`pnpm build` 与适用
  Rust workspace gates；
- [ ] 使用隔离 `userData` 的真实打包 App 验证冷/热打开、目录项目、live Run、pending Approval、
  recovery、较早消息和 notification anchor；
- [ ] 更新最终 Contract、Architecture、UI、文档路由和本版本“跨版本文档影响”，记录实际 before/after、
  测试数量、已知余量与未完成项；
- [ ] 运行 `pnpm docs:test`、`pnpm docs:check`、以真实 PR base SHA 执行
  `DOCS_BASE_REF=<sha> pnpm docs:check:ci`、`pnpm docs:adr:generate -- --check` 与
  `git diff --check`；
- [ ] 只有全部证据完成后，才把概览 `implementation_status` 与本计划 `status` 改为 `complete`。

## 当前完成定义

本次“开启版本”只完成 Checkpoint 0 中已勾选的 worktree、生命周期、范围和不可破坏边界。尚未交付
性能 instrumentation、轻量投影、关键路径调整、分页、Renderer 改造或真实 App 性能结果；不得从
`design_status: accepted` 推断这些实现已经存在。
