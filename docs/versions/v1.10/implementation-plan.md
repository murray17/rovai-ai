---
document_type: implementation-plan
version: v1.10
authority: implementation-plan-and-acceptance
status: complete
last_updated: 2026-08-18
---

# v1.10 实施与验收计划

## Checkpoint 0：版本与合同

- [x] 将完成的 v1.09 冻结为 historical，并建立唯一 current v1.10；
- [x] 接受 Runtime Launch and Verification v8 与 Run Process Detail Surface v9；
- [x] 更新 Runtime architecture、Camp UI、Settings brief、Contract/ADR current route 与文档导航。

## Checkpoint 1：公开结构与持久化

- [x] 建立仅支持 Claude Code/Antigravity 的 `RuntimeFailureView` closed fields 与 validation；
- [x] 以 Migration 94 / Data Contract v1.10 / projection schema 49 添加 AgentRun 与 Probe Attempt nullable JSON；
- [x] 接入 fail、dispatch rejection、planned shutdown、AgentRun read model 与 TypeScript contracts；
- [x] 保持完整 `error_detail`、原始 stderr/日志和公开 failure 的安全边界。

## Checkpoint 2：Runtime typed failures

- [x] Claude Code delivered failure 携带公开 failure，并覆盖 structured final、non-zero exit、compatibility 与 environment；
- [x] Antigravity delivered failure 携带公开 failure，并覆盖 structured final、non-zero exit、known private-log line、models 与 environment；
- [x] 稳定分类 authentication、rate limit、quota、model unavailable、permission denied 和其他明确 Runtime terminal/process failure；
- [x] 未知 `anyhow` error 不默认标记为 `origin=runtime`。

## Checkpoint 3：Availability 与 Renderer

- [x] Claude Code/Antigravity 显式检查 failure 进入 Probe Attempt 与 Product Runtime Availability；
- [x] 启动浅检瞬时 version failure 不产生产品级公开 failure，并保留 last-known-good；
- [x] failed Run 无 Evidence 时仍展示 Runtime 名称、origin 标题、summary/detail；
- [x] Runtime 设置行展示相同安全 failure，只有 `origin=rovai` 显示“Rovai 内部错误”；
- [x] TypeScript typecheck 与 Renderer 定向测试通过；Impeccable detector 只报告既存 CSS findings。

## Checkpoint 4：自动化门禁

- [x] `cargo check -p rovai-core --all-targets` 与 Runtime/health/持久化定向测试通过；
- [x] `pnpm test`、`pnpm build:desktop` 与完整文档治理通过；
- [x] `cargo fmt --all --check`、严格 Clippy、`cargo test -p rovai-core --lib` 与 `git diff --check` 通过；
- [x] 独立分支提交完成并把 commit 交给并行集成线程；由集成线程统一推送 main 与打包安装。

实际结果：`pnpm test` 通过 62 个 Vitest 文件/421 项测试与 187 项脚本测试；Rust lib 238 项、
core binary 97 项通过（4 项手工真实 Runtime smoke 按约束 ignored）；严格 Clippy、TypeScript typecheck、
desktop build、diff-aware docs CI、ADR generation check、formatter 与 diff check 均通过。

## 测试准入说明

- owner 分别是共享 public failure sanitizer/classifier、Claude/Agy parser、health probe、AgentRun 持久化和
  Renderer failure presentation；修复前相关错误只剩 generic code/digest 或被错误归为 Rovai；
- 纯映射矩阵扩展现有 owner tests；跨 SQLite/command/read model 的唯一持久化 seam 使用既有数据库 fixture，
  因为单元 serialization 无法证明 Migration 94、terminal command 与 read model 传递同一对象；
- Renderer 新独立测试只拥有 origin→标题的 closed mapping，执行台 early-return 与设置页消费继续扩展既有
  `App.test.ts`；最小验证为 `pnpm exec vitest run apps/desktop/src/renderer/src/RuntimeFailureNotice.test.ts
  apps/desktop/src/renderer/src/runtime-status.test.ts apps/desktop/src/renderer/src/App.test.ts`。

## References

- [v1.10 版本概览](README.md)
- [Runtime Launch and Verification v8](../../contracts/runtime-launch-and-verification-v8.md)
- [Run Process Detail Surface v9](../../contracts/run-process-detail-surface-v9.md)
- [Rust 测试准入与退役门槛](../../development/testing.md#rust-测试准入与退役门槛)
- [本地 Runtime 工作流](../../development/local-workflow.md)
