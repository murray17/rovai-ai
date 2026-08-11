---
document_type: implementation-plan
version: v0.58
authority: implementation-plan-and-acceptance
status: in_progress
last_updated: 2026-08-11
---

# v0.58 实施与验收计划

## Checkpoint 0：长期边界

- [x] 冻结 logical Runtime identity 与 mutable Installation/effective Runtime 的职责；
- [x] 明确一次 rebind 上限和 refresh 后的第二次完整校验；
- [x] 新增 ADR-0156 并更新 Runtime Architecture 与 CURRENT 路由。

## Checkpoint 1：Core 与持久化

- [x] dispatch 对可恢复 blocker/fingerprint drift 执行同步 refresh、re-resolve 与 rebind；
- [x] rebind 原子校验 logical identity、current snapshot、config digest、Run fence 与次数上限；
- [x] Migration 72 增加 initial Runtime evidence 和 `runtime_rebind_count`，既有 Run 原位回填；
- [x] 用户消息与 Message Delivery 两条生产 Run 创建路径写入 initial evidence；
- [x] 成功路径写入 `runtime_drift_detected` / `runtime_rebound`，失败保留具体 blocker/error code。

## Checkpoint 2：验证

- [x] 单元测试覆盖 runtime-default 漂移、Installation/policy identity 拒绝、initial/effective evidence、
  原子 rebind 和第二次 rebind 拒绝；
- [x] 完整 Rust workspace test、Clippy、format 与通用文档门禁通过；
- [x] 回填实际命令、测试计数与当前限制；
- [ ] 使用可控 Copilot CLI v1/v2 fixture 或真实原地升级完成 dispatch smoke，确认同一 Run 继续；
- [ ] 完成 Runtime drift smoke 后把版本状态同步为 complete。

## Checkpoint 3：真实请求复盘修正

- [x] Session Charter 明确 Runtime final 不进入公屏、公开回复必须成功调用 `rovai send`；
- [x] Session Charter contract 推进到 v2，使新 Run 轮换仍冻结旧 Charter 的 Session；
- [x] Canonical Activity lifecycle merge 保留 ACP started kind/title，稀疏 terminal 只更新状态；
- [x] Stop 只选择拥有 queued/running/waiting AgentRun 的 running/waiting Turn；
- [x] 增加 Charter、Bootstrap contract、Canonical lifecycle 和 Renderer cancellation 回归测试。

已完成自动化验证：

- `cargo test --workspace`：Library 315、CLI 10、Core binary 54 通过，3 个既有手工 Runtime smoke ignored；
- `pnpm test`：文档治理 21、Vitest 251、Node qualification/benchmark 147 通过；
- `cargo test -p rovai-core rebind -- --nocapture`：2 个新增 rebind 测试通过；
- `cargo test -p rovai-core db::tests::v72_backfills_initial_runtime_evidence_without_overwriting_existing_values -- --nocapture`：Migration 72 回填测试通过；
- `cargo clippy --workspace --all-targets -- -D warnings` 与 `cargo fmt --all -- --check` 通过；
- `pnpm docs:test`：21 个测试通过；`pnpm docs:check` 通过，覆盖 58 个版本目录与 156 个 ADR。

当前限制：自动 rebind 按 AgentRun 持久化限制为一次；尚未用真实 Copilot CLI 原地升级验证
`dispatch -> refresh -> rebind -> launch` 的完整进程链路，因此本版本仍为 `in_progress`。

## 完成条件

- [ ] 正常受信 CLI 原地升级不再产生 `runtime_integrity_failed` terminal Run；
- [x] identity/trust/auth/model/permission/protocol 无法重新确认时仍 fail closed；
- [x] 初始与有效 executable evidence 可审计，rebind 次数跨重启保持有界；
- [x] 文档、Migration、Core 实现和测试结论一致。
