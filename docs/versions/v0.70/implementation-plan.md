---
document_type: implementation-plan
version: v0.70
authority: implementation-plan-and-acceptance
status: in_progress
last_updated: 2026-08-13
---

# v0.70 实施与验收计划

## Checkpoint 0：语义与版本边界

- [x] 确认缺陷属于 Agent-facing teaching，而不是 `mentionUser` Core execution；
- [x] 固定唯一逐消息判据：新的未解决用户决定、回答或行动，或用户明确要求的重要结果通知；
- [x] 明确闭环责任是 Agent 使用指导，不能转化为 Core role authorization；
- [x] 接受 Camp Message Send v5 与 Built-in Tool Transport v8，不新增 ADR、Migration 或 UI 合同。

## Checkpoint 1：精确 help 与 schema

- [x] 集中 catalog summary、schema description、`--to-user` exact-help 文案和基础示例；
- [x] 删除基础 `--to + --to-user` 组合示例，改为 public-only、Agent-only、User-attention-only；
- [x] 精确 help 覆盖正向判据、负向场景、message-local、无 Delivery 与无批准语义；
- [x] `mentionUser` schema description 使用相同约束，并保留 boolean/default-false wire。

## Checkpoint 2：Charter 与 Skill

- [x] Session Charter 增加一条短边界，不复制完整 schema 或组合决策树；
- [x] Send reference 删除“需要用户查看”条件，增加 message-local non-inheritance；
- [x] 记录内部 Agent 与用户侧闭环责任，以及独立行动才允许组合的规则；
- [x] 保持 `cli-operations` 窄触发和七项 official inventory 不变。

## Checkpoint 3：Transport、catalog 与 Session compatibility

- [x] 升级 Built-in Tool contract/CLI command/capability 到 v8；
- [x] 保留 IPC、Envelope、receipt、Agent Output、Core send handler 与持久效果版本；
- [x] 增加 catalog digest 对 teaching schema 变化敏感的回归；
- [x] 增加 Antigravity v7 catalog identity 不能兼容续接 v8 binding 的回归，不全局轮换其他 Runtime Session。

## Checkpoint 4：自动化验证

- [x] 通过 `cargo fmt --all -- --check`；
- [x] 通过定向 Rust tests、`cargo test --workspace` 与 `cargo clippy --workspace --all-targets -- -D warnings`；
- [x] 通过 Built-in CLI/Skill 相关 Node 静态检查、全量 `pnpm test` 与 Codex v8 smoke；
- [x] 通过 `pnpm docs:test`、`pnpm docs:check`、ADR generated history 与 diff-aware docs CI；
- [x] 通过 `git diff --check` 并审阅无 Core effects、Migration、UI 或持久 schema 漂移。

## Checkpoint 5：真实 Runtime 行为

- [x] 使用 Codex Runtime 复现普通内部协作链，确认最终 Camp Message 不生成 Current User Mention；
- [x] 记录 Runtime/模型版本、Native Session 新建方式、输入场景与 exact addressing 证据；
- [ ] 发布前运行九 Runtime v8 Built-in CLI/Skill 矩阵，或明确保持版本 `in_progress` 且不更新兼容性结论。

## 当前证据

### 确定性门禁

- `cargo test -p rovai-core --lib`：397 passed；`cargo test -p rovai-core --bin rovai`：11 passed；
- `cargo test --workspace`：397 lib + 11 CLI + 72 Core binary passed，3 个显式 real-Runtime manual tests ignored；
- `cargo fmt --all -- --check` 与 `cargo clippy --workspace --all-targets -- -D warnings`：通过；
- `pnpm test`：Docs 21、Vitest 47 files / 311 tests、Node 179 tests 全部通过；`pnpm typecheck`：通过；
- `pnpm docs:test`、`pnpm docs:check`、`DOCS_BASE_REF=origin/main pnpm docs:check:ci`、
  `pnpm docs:adr:generate -- --check`：通过；
- `rovai --version` 为 `contract-v8 ipc-v1`；精确 Send help 的三类分离示例与负向断言通过；
- Codex 单 Runtime `smoke-builtin-cli` 完成 13 项 v8 operation、successor exact reads 与 Native Session
  continuation。运行时发现夹具曾错误要求 started evidence 携带 Core Envelope；现已限定为验证
  completed/failed terminal evidence，产品合同未变。

### 真实模型行为

2026-08-13 以自动验收通道、全新隔离 Core data-dir 和全新 Native Session 运行
`ROVAI_SKILL_SMOKE_ADAPTERS=codex-cli node scripts/smoke-skills.mjs`：

- Runtime：`codex-cli 0.147.0`；模型：`gpt-5.6-sol`；AgentRun：
  `5649c174-aff3-4a98-ae70-beb6edc882c6`；
- 输入场景是“创建已分配给目标 Agent 的持久责任，随后向同一 Agent 发布内部交接”；输入同时明确
  没有新的未解决用户决定、回答或行动，用户也未要求重要结果通知；
- Agent 读取 `rovai task create --help` 与 `rovai send --help` 后输出
  `attention=omit --to-user`；该 AgentRun 的最终结构化 Camp Message 不含
  `current_user_mention`；
- smoke 同时验证 official `cli-operations` Revision 与测试 Skill 均由隔离 managed library 投递。

v0.67 的九 Runtime v7 矩阵只证明旧 Core effects、CLI transport 和初版 Skill delivery，不证明本版本
收窄后的模型行为。九 Runtime v8 正式矩阵尚未执行，因此 v0.70 保持 `in_progress`，兼容性文档不声明
v8 real-model compatibility 已整体证明。
