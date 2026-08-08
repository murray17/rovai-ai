---
document_type: implementation-plan
version: v0.48
authority: implementation-plan-and-acceptance
status: complete
last_updated: 2026-08-08
---

# v0.48 实施与验收计划

## Checkpoint 0：设计与文档

- [x] 切换 v0.48 为唯一 current，冻结 ADR-0138～0143；
- [x] 冻结 Binding-generation-scoped durable revision 与 accepted-only ACK；
- [x] 冻结版本拥有的 `disabled | best_effort` 内部环境 policy；
- [x] 冻结 per-Runtime exact admission、prepared cutoff 与无 token heuristic；
- [x] 冻结 transient full-Bootstrap overlay、combined budget 与 identity privacy；
- [x] 冻结 Session-scoped Observer Lease、fencing、跨 Lease 去重，并用私有 durable relay outbox 实现 known-but-submission-unknown 中断边界；
- [x] 更新长期 Architecture、Runtime compatibility、domain language 与文档路由。

## Checkpoint 1：Persistence 与 Core Gate

- [x] Migration 66 / schema 26：policy epoch、Requirement、Observer Lease、observation ledger；
- [x] Runtime Input Delivery 持久化 redelivery revision/evidence/formatter metadata；
- [x] 首次 `disabled -> best_effort` 为已有 accepted current Binding 幂等建立 baseline；
- [x] Dynamic-only ContextManifest 与 transient complete Bootstrap overlay；
- [x] prepared cutoff 和 accepted ACK 消费冻结 revision；failure/unknown 不消费；
- [x] 后到 observation 不能被旧 Delivery ACK 清除。

## Checkpoint 2：Detector 与 Observer

- [x] Observer Lease 绑定 Binding generation，跨 AgentRun，Host/Binding/policy/Core restart fence；
- [x] Core/Host 并行 best-effort 建立，不参与 Runtime Readiness；
- [x] Copilot `preCompact`、OpenCode `session.compacted`、Kiro completed status；
- [x] Qoder、Qwen Code `PostCompact`，CodeBuddy `SessionStart(source=compact)`；
- [x] Hook payload exact source/trigger/session 验证与 Binding-generation dedup；
- [x] Claude Code / Codex 无 detector；Antigravity disabled；
- [x] 不因普通 Host exit 产生 Requirement，不增加 token heuristic。

## Checkpoint 3：真实 Runtime qualification

- [x] GitHub Copilot `1.0.78`：真实 `/compact` 触发 `preCompact(manual)`；
- [x] OpenCode `1.18.10`：真实 summarize 触发 `session.compacted`；
- [x] Kiro `2.16.1`：真实 compact 观察 nested started/completed，只接受 completed；
- [x] Qoder `1.1.14`：真实 `/compact` 触发 `PostCompact(manual)`；
- [x] CodeBuddy `2.133.1`：强制真实 emergency auto compaction 完成后触发 `SessionStart(source=compact)`；同时确认 pre-message compaction 不发相关 Hook，作为 `best_effort` coverage gap 记录；
- [x] Qwen Code `0.21.5`：真实 `/compress` 触发 `PostCompact(manual)`。

## Checkpoint 4：自动验收

- [x] `cargo fmt --all -- --check`；
- [x] `cargo check --workspace --all-targets`；
- [x] `cargo clippy --workspace --all-targets -- -D warnings`；
- [x] `cargo test --workspace`；
- [x] `pnpm typecheck`；
- [x] `pnpm docs:check`。

若最终提交前的同轮命令与此清单不一致，以版本概览的交付记录和 Git 提交证据为准，不以本清单
替代实际测试输出。
