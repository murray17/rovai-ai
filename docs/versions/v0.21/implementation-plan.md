---
document_type: implementation-plan
version: v0.21
lifecycle: historical
authority: implementation-plan-and-acceptance
last_updated: 2026-07-29
---

# Rovai-ai v0.21 实施计划与验收清单

> 状态：实施完成，验收通过
>
> 版本范围：[README.md](README.md)
>
> 详细设计：[architecture.md](architecture.md)

本文件冻结实施顺序与验收边界。架构已获用户确认；检查项只有在相应代码、Migration、
测试或可复现验收证据存在后才能标记完成。

## 检查点 0：领域模型与架构切换

- [x] 完成逐项设计访谈并明确冲突、失败和恢复场景。
- [x] 更新 `CONTEXT.md` 中被删除、替代或新增的正式领域词。
- [x] 接受 ADR-0067～ADR-0070，并原子维护旧 ADR 的 `superseded_by`。
- [x] 冻结 `native_session_bootstrap_v1`、Context Formatter v4、ContextManifest v4、
  Memory Team Tool v1 和 Search/Read Evidence v1。

## 检查点 1：直接 Schema 切换与合同

- [x] 直接重建未发布的 Memory 表族；不迁移旧 Memory、Revision、Proposal、
  Projection Observation 或 Authority 数据，不保留兼容 View/字段/双写。
- [x] 增加 Memory Origin、Revision Actor、Retrieval Keys、Hearth Memory Proposal、
  FTS5 trigram、`agentMemoryWritesEnabled` 和新 Capability 默认值。
- [x] 增加 Native Session Bootstrap Evidence、ContextManifest v4 与 Run Attachment
  Projection 引用；删除旧 ContextManifest 的 Work Brief、Task Context、Control
  Signals 和 Memory Guide 字段。
- [x] 约束 Hearth 32、Companion 32、Relationship Pair 12、Agent 适用
  Relationship 48，以及 Agent-origin 0/8/4/16；无 Scope 聚合字节配额。
- [x] 不保留 Formatter-v3/旧 ContextManifest 的活动恢复路径；开发数据库允许整体
  重建。若 Migration 选择保留无关只读历史，必须让不兼容 Binding/非终态输入不可
  Resume，且不得翻译或重组旧载荷。
- [x] Fresh/rebuilt database 重复打开结果稳定；不存在为未发布旧数据提供的
  compatibility flag、双 schema 或 backfill。

## 检查点 2：Memory 权威写入

- [x] 删除 `MemoryRevisionAuthority`、确认命令、通用 `MemoryProposal`、
  policy-auto resolution、provisional 容量和旧自动形成策略。
- [x] 用户 create/revise/lifecycle/review/supersession/forget 继续经过
  DomainCommandGateway、expected version 与 body-free audit。
- [x] `memory.write` 只允许 Companion(current Agent) 与当前 Camp 可访问的
  Relationship add/revise；Relationship 只允许 mutual 或 actor→counterparty。
- [x] `memory.propose_hearth` 只产生非有效 Hearth Proposal；用户逐条接受、
  编辑后接受或拒绝，stale revise 不可接受或原地 rebase。
- [x] 两个 Agent 工具共享每 Run 四次成功持久化配额，同时执行实时全局开关、冻结
  Capability、fence、Presence、Scope、Secret Filter、duplicate/no-op、CAS 与容量。
- [x] Forget 与 Proposal 拒绝同步清除所有受控候选/正文位置；事件、receipt、
  command result 和诊断不复制正文。

## 检查点 3：Memory Entrypoint、Search 与 Read

- [x] 每个 Revision 强制 1～3 个 Retrieval Keys 并执行长度、规范化、保留词和字符
  校验；body 继续限制为 2,048 UTF-8 bytes。
- [x] Bootstrap 生成稳定 ID 的 16/32/24、总 72 行 Entrypoint，排序与
  Relationship counterparty 分配完全确定。
- [x] `memory.search` 先鉴权再查询 active current FTS，执行 query、result、snippet
  和总响应预算；FTS 损坏时失败关闭并支持确定性重建。
- [x] `memory.read` 每次实时鉴权，当前可读项只返回最新 Revision；对同 Binding
  generation 已有读取证据的旧缓存返回 `revision_changed | inactive | deleted |
  access_changed`，否则统一 `unavailable`，所有失效结果都不含旧正文。
- [x] Add/revise/retire/forget/Presence/适用范围变化不会轮换 Native Session；新
  Memory 可由 Search 发现，旧 Entrypoint 行不能重新授予权限。

## 检查点 4：Bootstrap 与 AgentRun Dynamic Context

- [x] 新 Native Binding generation 在任何动态输入前持久化唯一 Bootstrap Evidence，
  同 generation 的恢复只复用冻结字节。
- [x] `native_append` 与 `first_payload` 生成相同逻辑 Bootstrap；准备失败、投递未知和
  ACK 未持久化路径全部 fail closed 或先对账。
- [x] Formatter v4 只输出条件性的 Collaboration State、Shared Conversation、Run
  Notices 与必需 Current Input；旧七个独立区段和通用执行口号完全退出新 Run。
- [x] Shared Conversation 保持摘要/原文无重叠无缺口、当前输入去重、Coverage
  Baseline 和 `context.search` 入口；Marker 只在已接受输入后单调推进。
- [x] 六种 Run Notice 均由结构化权威事实生成，不暴露内部 ID/计数器，也不从自然语言
  推断。
- [x] A2A Current Input 只暴露 senderName 与 `replyTarget: source`；`recipient:
  "source"` 只从可信 source Inbox 解析并仅为该来源补全 reply correlation。
- [x] Task Context 不再注入；`team.list_tasks` 是 Agent 获取当前 Task 的唯一结构化
  Read Side。

## 检查点 5：附件与 Runtime Adapter

- [x] Managed Blob 在 Dispatch 前形成只读、冲突安全、可重建且路径稳定的 Run
  Attachment Projection；ContextManifest 冻结路径、Blob 根引用和 digest。
- [x] 每个 Adapter 都能将投影加入当前 Runtime 的真实可读范围；无法证明可读时拒绝
  执行，不使用正文注入、原宿主路径或 `managed-blob://` fallback。
- [x] Codex/Claude 等原生追加路径与 ACP/Antigravity first-payload 路径都有合同测试；
  Core 重启、Resume、Binding 轮换和 delivery_unknown 均保持字节级恢复。

## 检查点 6：Read Side 与 Desktop

- [x] Context Inspector 分开展示 Bootstrap Evidence 与 AgentRun Dynamic Context，
  能解释 formatter、digest、coverage、Notice 和附件投影，不把内部字段暴露成模型输入。
- [x] 长期记忆页删除 Authority、`provisional`、确认操作和普通 Proposal 队列；列表
  只把用户创建、伙伴形成、伙伴提议后采纳及 Revision Actor 作为来源/审计信息。
- [x] 页面提供 `agentMemoryWritesEnabled`、Hearth Proposal 抽屉、Retrieval Keys、
  32/32/12/48 与 0/8/4/16 容量、Review/Lifecycle 和安全 Forget 交互。
- [x] Companion/Relationship Agent 写入通知不要求确认；Hearth Proposal 使用独立
  attention 通知与待确认入口。
- [x] Day/Night、`1440×920`、`1040×700`、键盘、焦点、Drawer、Loading、Empty、
  Error、CAS conflict 和 reduced-motion 全部通过视觉与无障碍验收。

## 检查点 7：自动化与真实 Runtime 验收

- [x] 单元/属性测试覆盖 formatter 确定性、容量交叉约束、Retrieval Keys、Scope/
  Direction、来源保持、CAS、Secret Filter、side-channel 状态映射和响应字节预算。
- [x] 集成测试覆盖新 Session、首 Run、后续 Run、Resume、替代 Session、A2A source、
  超预算历史、Task 工具化、附件重建、Core 重启和 unknown-delivery 对账。
- [x] Memory 集成测试覆盖直接 add/revise、Hearth accept/edit/reject/stale、全局
  policy 即时关闭、Run 四次配额、FTS rebuild、缓存过期/删除/权限收缩和 Forget。
- [x] 每种 Bootstrap delivery mode 至少完成一个真实 Runtime Smoke；其余支持的
  Adapter 完成协议合同测试与现有 Runtime Smoke 回归。
- [x] 完整 workspace 测试、Renderer typecheck/build、Rust test/clippy 和打包 App
  验收通过；失败与平台限制如实记录，不以文档勾选替代证据。

## 完成定义

v0.21 只有在以下事实同时成立时完成：

- 新 Run 的模型载荷与 Memory 工具中不存在旧 Context 区段、Memory Guide、
  `memory.propose_change`、Revision Authority 或非 Hearth pending Proposal 路径；
- 相同 Bootstrap/ContextManifest 在崩溃恢复中保持相同字节与 digest，Marker 不会在
  ACK 前推进；
- 任意 Memory 变化都不靠 Session 轮换维持正确性，`memory.read` 对失效缓存只返回
  明确状态而不返回旧正文；
- Companion/Relationship Agent 写入立即生效，Hearth Agent 提议只有用户决定后生效，
  UI 不再要求确认普通 Agent Memory；
- Schema、Core、Gateway、Adapter、Read Side、Desktop、自动测试和真实 Runtime
  验收对同一合同达成一致。

`[x]` 只能由代码、Migration、自动测试或可复现验收证据支持。

## 验收证据（2026-07-29）

- `cargo test -p rovai-core --all-targets -- --nocapture`：189 个 Library 测试与
  45 个 Binary 测试通过；5 个仅供手工触发的隔离 Runtime 测试保持 `ignored`。
- `cargo clippy -p rovai-core --all-targets -- -D warnings`、`pnpm typecheck`、
  `pnpm test`（103 个 Renderer/合同测试）与 `pnpm build:desktop` 通过。
- `smoke-memory.mjs` 验证 Memory v2、Hearth 32、单一有效状态、来源/Revision Actor、
  Retrieval Keys、Secret Filter、Forget、重启稳定和 body-free diagnostics。
- `smoke-memory-runtime.mjs` 在 Codex CLI 0.145.0 与 Claude Code 2.1.212 上验证
  Agent Companion Memory 立即生效且重启不重复。
- `smoke-team-context.mjs` 验证 Codex A→B→A、`recipient: source`、reply correlation、
  ContextManifest v4 与重启恢复；`smoke-team-task-tools.mjs` 验证 Task 工具化读写。
- `smoke-antigravity-runtime.mjs` 在 Antigravity 1.1.8 上验证 `first_payload`、
  Native Session 延续、跨 Adapter 替换和私有日志清理。
- `pnpm package:mac` 生成 arm64 macOS App；`accept-memory-ui.mjs` 验证打包
  Renderer→Core IPC、默认开启设置、create/revise、retire/reactivate、Forget、
  重启持久性，以及 `1440×920` Day / `1040×700` Night 无横向溢出。
