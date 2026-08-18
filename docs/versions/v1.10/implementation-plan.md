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
- [x] 确认 Camp 模型上下文 revision 1，接受迁移前 ADR-0219、Camp Identity v1、ContextManifest v18、Camp History
  v3、Built-in Transport v16、Runtime Launch v8 与 Run Process Detail Surface v9；
- [x] 更新 Camp/Runtime architecture、Camp UI、Settings brief、Contract/ADR current route 与文档导航。

## Checkpoint 1：Camp identity clean break

- [x] 建立 UUIDv7-backed canonical `CampId`，覆盖生成、strict parse、Serde、SQLite、Display 与 TypeScript；
- [x] Camp 创建、数据库关系、Desktop 参数、领域命令、History target、Built-in schema 和 Attachment path
  统一使用唯一 `rvcamp_...`，无 CampRef/UUID alias；
- [x] 更新 Context fixture v20、Renderer navigation/onboarding/pin/restorable/timeline storage 并拒绝旧状态；
- [x] 保持 Native Session/Thread/Turn/Conversation/Binding identity 独立且不接受 Camp ID resume；
- [x] 以 migration 95 / schema 50 安装 Formatter20/Manifest18，失效旧 context、binding 与非终态执行。

## Checkpoint 2：公开结构与持久化

- [x] 建立仅支持 Claude Code/Antigravity 的 `RuntimeFailureView` closed fields 与 validation；
- [x] 以 Migration 94 / Data Contract v1.10 / projection schema 49 添加 AgentRun 与 Probe Attempt nullable JSON；
- [x] 接入 fail、dispatch rejection、planned shutdown、AgentRun read model 与 TypeScript contracts；
- [x] 保持完整 `error_detail`、原始 stderr/日志和公开 failure 的安全边界。

## Checkpoint 3：Runtime typed failures

- [x] Claude Code delivered failure 携带公开 failure，并覆盖 structured final、non-zero exit、compatibility 与 environment；
- [x] Antigravity delivered failure 携带公开 failure，并覆盖 structured final、non-zero exit、known private-log line、models 与 environment；
- [x] 稳定分类 authentication、rate limit、quota、model unavailable、permission denied 和其他明确 Runtime terminal/process failure；
- [x] 未知 `anyhow` error 不默认标记为 `origin=runtime`。

## Checkpoint 4：Availability 与 Renderer

- [x] Claude Code/Antigravity 显式检查 failure 进入 Probe Attempt 与 Product Runtime Availability；
- [x] 启动浅检瞬时 version failure 不产生产品级公开 failure，并保留 last-known-good；
- [x] failed Run 无 Evidence 时仍展示 Runtime 名称、origin 标题、summary/detail；
- [x] Runtime 设置行展示相同安全 failure，只有 `origin=rovai` 显示“Rovai 内部错误”；
- [x] TypeScript typecheck 与 Renderer 定向测试通过；Impeccable detector 只报告既存 CSS findings。

## Checkpoint 5：自动化门禁

- [x] `cargo check -p rovai-core --all-targets` 与 Runtime/health/持久化定向测试通过；
- [x] `pnpm test`、`pnpm build:desktop` 与完整文档治理通过；
- [x] `cargo fmt --all --check`、严格 Clippy、`cargo test -p rovai-core --lib` 与 `git diff --check` 通过；
- [x] Runtime 独立提交已进入 Camp ID 集成分支，migration 顺序固定为 94→95、schema 49→50；
- [x] 最终集成全量门禁、macOS package/签名/arm64/隔离 userData 验收、main push 与 Applications 提升完成。

最终组合门禁：`pnpm test` 通过 62 个 Vitest 文件/421 项测试与 187 项脚本测试；Rust PR 三段通过
244 项 fast library、15 项 CLI 与 258 项 slow integration；workspace all-features 通过 532 项 library、
15 项 CLI 与 97 项 core binary（4 项手工真实 Runtime smoke 按约束 ignored）。默认与 all-features 严格
Clippy、TypeScript typecheck、desktop build、migration 91/95 定向测试、diff-aware docs CI、ADR generation、
formatter 与 diff check 均通过。`8a2d14e4` 已推送 `main`；其 arm64 App、Core 与 CLI 通过 strict codesign，
bundle 内 Core/CLI Mach-O UUID 与 release 产物一致。`dist` 和安装位置分别使用全新隔离 `userData` 启动至
Core ready，均确认 Data Contract `v1.10`、projection schema 50、migration 95；最终安装位置为
`/Applications/Rovai AI.app`，安装版受控退出无未解决执行。

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
- [模型上下文 revision 1](model-context-change.md)
- [Camp Identity v1](../../contracts/camp-identity-v1.md)
- [Camp Identity Architecture](../../architecture/camp-identity.md)
- [Runtime Launch and Verification v8](../../contracts/runtime-launch-and-verification-v8.md)
- [Run Process Detail Surface v9](../../contracts/run-process-detail-surface-v9.md)
- [Rust 测试准入与退役门槛](../../development/testing.md#rust-测试准入与退役门槛)
- [本地 Runtime 工作流](../../development/local-workflow.md)
