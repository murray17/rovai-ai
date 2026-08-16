---
document_type: implementation-plan
version: v0.92
authority: implementation-plan-and-acceptance
status: complete
last_updated: 2026-08-16
---

# v0.92 实施与验收计划

## Checkpoint 0：版本与长期边界

- [x] 冻结 v0.91，建立唯一 current v0.92 与九范围影响记录；
- [x] 接受 ADR-0198，并更新 Built-in Tool Runtime、领域词汇与 ADR 导航；
- [x] 通过 ADR generator、版本生命周期与 base-aware 文档门禁。

## Checkpoint 1：Skill 协议与路由

- [x] 两份 Grill Duo Skill 改为每轮 1–4 个彼此独立问题；
- [x] 补齐开放轮次、部分回答、稳定编号、单题失效重审与下一轮准入规则；
- [x] 补齐当前 AgentRun、固定搭档资格、可信 Agent ID、直接回复和迟到建议边界；
- [x] 所有 partner/user send 分支明确只在 `accepted` 后结束当前响应；
- [x] 普通版排除领域词汇/ADR 维护，文档版只维护用户已确认内容；
- [x] description 收敛为适用、继续与排除边界，short description 扩展至推荐长度。
- [x] Campfire description 同步采用自然语言路由结构，不改变现有 Gather 流程。

## Checkpoint 2：Bundled 内容与测试

- [x] 删除文档版共享 `references/grill-duo.md`；
- [x] 删除 Core `include_str!` 与 embedded manifest 项，把文档版 Revision 文件数收敛为五；
- [x] 更新 existing official Skill 语义测试，并同时修复当前 Campfire bundled source 的陈旧断言；
- [x] Skill validator、Core 定向测试与 Rust workspace 回归通过。

## Checkpoint 3：文档治理与交付

- [x] 更新 `CONTEXT.md`、Architecture、版本记录和 successor ADR；
- [x] 把 Skill description 与界面元数据规范写入开发文档；
- [x] Rust fmt/Clippy、仓库测试、文档治理与 diff 检查通过；
- [x] 复核最终文件集合与版本状态，记录自动验收证据。

## 自动验收证据

- 两份 Skill 分别通过 `quick_validate.py`；文档版 Revision 文件集合精确为五项，共享 duo reference
  不存在，两个 `short_description` 均为 33 个字符；
- `cargo test -p rovai-core skill::tests::official_skills_apply_management_policy_and_preserve_user_managed_changes --lib`：
  1/1 通过，覆盖 bundled manifest、开放轮次、关联规则、description 与 metadata 边界；
- `cargo test --workspace`：library 483/483、CLI 12/12、Core binary 79/79 通过；3 项明确的 manual local
  Runtime smoke 保持 ignored；
- `cargo fmt --all -- --check` 与 `cargo clippy --workspace --all-targets -- -D warnings`：通过；
- `pnpm typecheck`、359 项 Vitest 与 186 项 Node 测试：通过；
- `pnpm docs:test`、`pnpm docs:check`、以 `ce5337b27e619f0293521d7ab5a97975bb720808` 为 base 的
  `pnpm docs:check:ci`、ADR generator check：通过；
- `git diff --check`：通过；未运行真实 Runtime smoke、Desktop build 或打包，不将其记为通过。
