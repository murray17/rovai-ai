---
document_type: implementation-plan
version: v0.91
authority: implementation-plan-and-acceptance
status: complete
last_updated: 2026-08-16
---

# v0.91 实施与验收计划

## Checkpoint 0：版本与长期边界

- [x] 冻结 v0.90，建立唯一 current v0.91 与九范围影响记录；
- [x] 接受 ADR-0197，并更新 MCP 当前 Architecture、领域词汇与 ADR 导航；
- [x] 通过 ADR generator、版本生命周期与 base-aware 文档门禁。

## Checkpoint 1：空配置与 clean break

- [x] 删除 Context7/Playwright 常量、固定包版本与 reviewed defaults；
- [x] 新配置原子创建精确 schema v2 空 Library；
- [x] 启动迁移只按 `source: builtin` 删除 Server/Assignment，保留 user/import 同名项并证明幂等；
- [x] 无法进入严格当前 Schema 的预发布配置删除后重新初始化为空。

## Checkpoint 2：Contract、Renderer 与验收脚本

- [x] 删除 `presetId`、built-in source contract、预设首字母与样式；
- [x] MCP 空状态只保留手动添加和本机配置导入；
- [x] 删除 preset Smoke，改写 packaged MCP 操作链为空 Library 起步；
- [x] 完成 Renderer 定向测试、Impeccable detector 与隔离 packaged App MCP 验收；detector 仅报告
  `styles.css` 既有全文件告警，本次新增/删除选择器没有新增命中。

## Checkpoint 3：回归与交付

- [x] Rust fmt、11 个 MCP 定向测试与 strict Clippy 通过；全工作区 483 项中 482 项通过，唯一
  Campfire official-skill 规则失败在 clean worktree 复现为当前 `main` 基线问题，与 MCP diff 无关；
- [x] TypeScript、359 个 Vitest、186 个 Node 测试、文档治理与 Desktop build 通过；
- [x] macOS arm64 App 打包、ad-hoc hardened-runtime 签名/架构检查与隔离验收通过；
- [x] 功能提交推送 `main`，验收构建安装并从 `/Applications/Rovai AI.app` 重新启动。

## 自动验收证据

- `cargo test -p rovai-core mcp::tests --lib`：11/11 通过，覆盖空初始化、按 source 清理、同名保留、
  幂等、无效预发布配置重置、CRUD、Assignment 与风险确认；
- `cargo test --workspace`：482/483 通过；唯一失败为
  `skill::tests::official_skills_apply_management_policy_and_preserve_user_managed_changes`，在不含用户
  未提交改动的 clean worktree 同样复现，缺失的是 Campfire 文案规则；
- `cargo fmt --all -- --check`、`cargo clippy --workspace --all-targets -- -D warnings`、
  `pnpm typecheck`、`pnpm test`、`pnpm build:desktop`：通过；
- `pnpm docs:test`、`pnpm docs:check`、base `dc050326` 的 `pnpm docs:check:ci` 与 ADR generator check：
  通过；
- `pnpm package:mac`：生成 `dist/mac-arm64/Rovai-ai.app`；`codesign --verify --deep --strict` 通过，App、
  `rovai-core` 与 `rovai` 均为 arm64；
- `node scripts/capture-mcp.mjs ...`：隔离 userData 下完整通过，证明 fresh Library 为空、无自动导入、
  手动添加、确认导入、编辑、删除、启停、Assignment、批量 Assignment、权限修复和键盘导航；
- 功能提交 `6aa8e165` 已推送 `origin/main`；同一验收 bundle 已替换 `/Applications/Rovai AI.app`，
  日常配置启动后为 0 Server、0 Assignment、0 builtin、0 `presetId`；旧 bundle 可从废纸篓恢复；
- 未执行真实模型 Runtime Smoke，未将其记为通过。
