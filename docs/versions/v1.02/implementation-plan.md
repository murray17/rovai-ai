---
document_type: implementation-plan
version: v1.02
authority: implementation-plan-and-acceptance
status: complete
last_updated: 2026-08-17
---

# v1.02 实施与验收计划

## 计划状态与使用方式

本计划实现 [Runtime Usage Monitoring v3](../../contracts/runtime-usage-monitoring-v3.md)，不改变
[ADR-0205](../v0.99/decisions.md#adr-0205) 的长期数据模型。修改 Rust 测试遵守
[Rust 测试准入与退役门槛](../../development/testing.md#rust-测试准入与退役门槛)；真实 Runtime 遵守
[本地 Runtime 工作流](../../development/local-workflow.md)。

## Checkpoint 0：治理与证据

- [x] 开启唯一 current v1.02 并冻结 v1.01；
- [x] 接受 Runtime Usage Monitoring v3，更新架构与兼容性路由；
- [x] 审计 OpenCode 1.18.15 `buildUsage()` 与 `totalSessionCost(messages)` 上游实现；
- [x] 使用隔离工作目录完成 OpenCode Zen 与 DeepSeek 真实成功探针，未把未上报 Cache Write 推断为零值证据。

## Checkpoint 1：OpenCode Token/Cache

- [x] parser 接收冻结 Runtime version，只对 OpenCode `>= 1.18.15` 启用 omitted-zero；
- [x] 归一化 Prompt Total、Uncached、Read、Write、Output、Reasoning 和 request cache hit；
- [x] 扩大 OpenCode Eligibility，并排除累计 Session cost 的 Run 归因；
- [x] 增加带 provenance 的上游成功 Cache Write Fixture和本机省略零值回归。

## Checkpoint 2：Codex Cost Projection

- [x] 增加 model/tier/effective-date 版本化 OpenAI API Pricing Catalog；
- [x] Codex `>= 0.145.0` 四桶完整时写 `price_estimated / price_catalog / USD`；
- [x] Reasoning 不额外计费，catalog version 与 Cost Eligibility 一并保存；
- [x] 不新增 Runtime Cost parser、Credits 事件表或 Provider 网络读取。

## Checkpoint 3：最终验收

- [x] 定向与全量 Rust、fmt、严格 Clippy、TypeScript、Desktop build 通过；
- [x] `pnpm docs:test`、`pnpm docs:check`、diff-aware 文档门禁与 `git diff --check` 通过；
- [x] 聚合测试的已知基线失败与本版本结果分开记录；
- [x] 回填实际命令、commit 与真实探针限制，版本状态改为 complete。

## 最终验收结果

- 实现 commit：`f7d419c3`；
- `cargo fmt --all --check`、`cargo clippy --workspace --all-targets -- -D warnings` 与
  `cargo check -p rovai-core --bin rovai-core` 通过；
- `cargo test --workspace -- --quiet --test-threads=2` 通过：Library 228/228、CLI 12/12、Core Main
  90/90，另有 3 个既有 ignored 测试；
- `pnpm typecheck`、`pnpm exec vitest run`（59 Files、403 Tests）和 `pnpm build:desktop` 通过；
- `pnpm docs:test`、`pnpm docs:check`、`DOCS_BASE_REF=origin/main pnpm docs:check:ci`、
  `pnpm docs:adr:generate -- --check` 与 `git diff --check` 通过；
- 聚合 `pnpm test` 仅复现 `current-contract-conformance.test.mjs` 对已改名 Rust 测试函数的既有断言失败；
  该测试文件与 `crates/rovai-core/src/db.rs` 均和 `origin/main` 字节一致，本版本未修改这条基线。

## 当前证据

- OpenCode 官方 `v1.18.15` / commit `d7b115f623760e68a4749d16508a9eca350f246f`：成功
  `end_turn` Fixture 明确返回 Input 100、Output 40、Thought 7、Cache Read 11、Cache Write 13；
- 本机 OpenCode `1.18.15` + `opencode/hy3-free`，长 Prompt 成功，terminal 返回 Input 65193、Output 3、
  Thought 54、Cache Read 1728，未返回 Cache Write；
- 本机 OpenCode `1.18.15` + `deepseek/deepseek-v4-flash`，复用 Qwen 的本机凭据、隔离长 Prompt成功，
  terminal 返回 Input 52448、Output 2，未返回 Thought/Cache Read/Cache Write；
- 两次真实探针均未修改日常 Runtime 配置，也未读取或回显 API secret。它们证明当前 Provider 覆盖边界，
  不冒充 `cachedWriteTokens > 0` 的 Provider 实测；正值合同来自同版本官方成功 Turn Fixture。

## References

- [v1.02 版本概览](README.md)
- [Runtime Usage Monitoring v3](../../contracts/runtime-usage-monitoring-v3.md)
- [Runtime Monitoring 架构](../../architecture/runtime-monitoring.md)
