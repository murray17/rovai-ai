---
document_type: implementation-plan
version: v1.04
authority: implementation-plan-and-acceptance
status: complete
last_updated: 2026-08-18
---

# v1.04 实施与验收计划

## 计划状态与使用方式

本计划实现 [ADR-0209](../../adr/0209-bounded-trae-cold-session-history-restore.md)与
[Runtime Launch and Verification v7](../../contracts/runtime-launch-and-verification-v7.md)。Rust 测试遵守
[准入与退役门槛](../../development/testing.md#rust-测试准入与退役门槛)，真实 Runtime 遵守
[本地 Runtime 工作流](../../development/local-workflow.md)。

## Checkpoint 0：Probe 与治理

- [x] 使用 ACP `session/new` 返回的精确 ID，补测 prefix/suffix `--resume=<id>`；
- [x] 确认普通 ACP Host 正常、两种 Provider Resume 均无法 initialize；
- [x] 开启唯一 current v1.04，接受 ADR-0209 与 Runtime Launch and Verification v6。

## Checkpoint 1：HistoryRestore 控制面

- [x] TRAE continuation 在 resume capability 缺席时选择独立 HistoryRestore；
- [x] 在 `session/load` 前建立 `LoadingReplay` route，在成功 response 后进入 Ready；
- [x] replay event/server request 静默 quarantine，不产生 AgentRun 或 Renderer 投影；
- [x] 事件、字节、时间与协议异常均能拒绝 pending load；
- [x] 兼容性 key 覆盖 executable、workspace、模型、权限和 Host 配置；
- [x] 失败记录 continuity lost、停止旧 Host、轮换 Binding 并建立新 Session。

## Checkpoint 1.1：exact-ID response 缺陷修正

- [x] restore response 省略 `sessionId` 或返回原始 ID 时继续使用原始 exact ID；
- [x] restore response 返回不同 ID 时标记 Host protocol-violated 并进入既有 continuity-lost fallback；
- [x] 禁止 `unbind old -> bind returned ID`，返回 ID 不进入 known sessions、Runtime 或持久 Native Binding；
- [x] Runtime Launch and Verification v7 替代 v6 的旧 response 换绑语义。

## Checkpoint 2：验收

- [x] 单元/协议测试覆盖 warm reuse、load barrier、历史 tool/approval/usage 隔离和异常拒绝；
- [x] 测试覆盖 Session compatibility 输入变化和跨 Camp Fleet 隔离；
- [x] 真实 Core smoke 覆盖冷 Host/Core 重启 marker、当前 tool/approval/cancel 与错误 ID fallback；
- [x] 全量 Rust、fmt、Clippy 与文档门禁通过；
- [x] 最终差异复核并将版本状态更新为 complete。

## 最终验收结果

- 本机 TRAE `0.120.52` 的普通 ACP Host 约 0.9 秒 initialize；prefix/suffix 两种
  `--resume=<exact-id>` 均在 30 秒内无 initialize，Provider Resume 未启用；
- `pnpm smoke:trae-cold-resume` 通过：Core 重启后 Host ID 变化、Native Session ID 不变、私密 marker
  恢复，replay Action/Approval 均为 0；恢复后新工具/Approval 成功，cancel 后目标文件不存在；错误 Session
  ID 换用新 ID 并持久记录一次 continuity lost；
- `history_restore_protocol_anomalies_fail_closed` 通过：恢复 response 返回不同 ID 时 Host
  protocol-violated，返回 ID 不进入 route、known sessions、Runtime verification evidence 或持久 Binding；
- `cargo test --workspace -- --test-threads=2` 通过：Library 227/227、CLI 12/12、Core Main 94/94，另有
  4 个明确 ignored 的手工 Runtime smoke；
- `cargo fmt --all --check`、`cargo clippy --workspace --all-targets -- -D warnings`、`pnpm typecheck` 与
  Vitest 59 Files / 403 Tests 通过；
- `pnpm docs:test`、`pnpm docs:check`、`DOCS_BASE_REF=origin/main pnpm docs:check:ci`、
  `pnpm docs:adr:generate -- --check`、Smoke 脚本语法检查与 `git diff --check` 通过；
- 仓库既有 `pnpm test` 仍有一个与本版 diff 无关的 Benchmark profile locator 基线失败：profile 引用已被
  上游移除的 `current_data_contract_accepts_current_and_exact_upgrade_sources`；`origin/main` 中同一引用与
  缺失状态一致，本版未扩大范围修改该 Benchmark 合同。

## References

- [v1.04 版本概览](README.md)
- [ADR-0209](../../adr/0209-bounded-trae-cold-session-history-restore.md)
- [Runtime Launch and Verification v7](../../contracts/runtime-launch-and-verification-v7.md)
