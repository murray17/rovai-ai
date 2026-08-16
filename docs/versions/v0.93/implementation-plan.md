---
document_type: implementation-plan
version: v0.93
authority: implementation-plan-and-acceptance
status: complete
last_updated: 2026-08-16
---

# v0.93 实施与验收计划

## Checkpoint 0：版本与长期边界

- [x] 冻结 v0.92，建立唯一 current v0.93 与九范围影响记录；
- [x] 接受 ADR-0199，并更新 Built-in Tool Runtime、领域词汇与 ADR 导航；
- [x] 通过 ADR generator、版本生命周期与 base-aware 文档门禁。

## Checkpoint 1：Review Duo 精简

- [x] 用可信固定搭档、直接回复和不可变评审范围建立四消息正常流程；
- [x] 删除请求消息 ID、parts、manifest、locator 与确定性历史恢复依赖；
- [x] 补齐每轴 finding/正文限制、最终有界摘要和 `effectiveRecipients` 边界；
- [x] 补齐搭档固定、更换、迟到结果、会话完成与只读降级规则；
- [x] 把 bundled 文件集合从十一项收敛为五项。

## Checkpoint 2：Grill Duo CLI 去重

- [x] 两份 Grill Duo 各建立唯一“消息方式”章节；
- [x] 搭档请求、建议返回和用户提问三种命令各只保留一次；
- [x] 保持 ADR-0198 的开放轮次、当前 Run、可信搭档、直接回复和 accepted 语义不变。

## Checkpoint 3：Core、文档与验收

- [x] 删除六个 Review Duo `include_str!` 与 embedded manifest 项；
- [x] 更新 official Skill 文件集合和语义测试；
- [x] 同步 Architecture、`CONTEXT.md`、版本记录与 ADR；
- [x] 三个 Skill validator、Rust、文档治理和 diff 门禁全部通过；
- [x] 记录自动验收证据并把版本状态更新为 complete。

## 自动验收证据

- `review-duo`、`grill-duo` 与 `grill-duo-with-docs` 均通过 `quick_validate.py`；Review Duo
  Revision 精确为五项，两个 Grill 的 `rovai send` 示例各精确为三次；
- Core official Skill 定向测试 1/1 通过；`cargo test --workspace` 的 library 483/483、CLI 12/12、
  Core binary 79/79 通过，3 项 manual local Runtime smoke 保持 ignored；
- `cargo fmt --all -- --check`、`cargo clippy --workspace --all-targets -- -D warnings` 与
  `pnpm typecheck` 通过；
- `pnpm test` 的文档单测 21/21、Vitest 359/359、Node 测试 186/186 通过；
- `pnpm docs:check`、`pnpm docs:adr:generate -- --check` 与以
  `562abfb30581628b39779d25ce67403fce3cb1dc` 为 base 的 `pnpm docs:check:ci` 通过；
- `git diff --check` 通过；未运行真实 Runtime smoke、Desktop build 或打包，不将其记为通过。
