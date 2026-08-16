---
document_type: implementation-plan
version: v0.94
authority: implementation-plan-and-acceptance
status: complete
last_updated: 2026-08-16
---

# v0.94 实施与验收计划

## Checkpoint 0：变更治理与长期边界

- [x] 冻结 v0.93，建立唯一 current v0.94 与九范围影响记录；
- [x] 保存独立核心上下文变更说明，并记录开发者对 revision 1 的明确二次确认；
- [x] 建立 Bootstrap/Dynamic Context 常青治理规则与版本文档门禁；
- [x] 接受 ADR-0200，更新 CURRENT/HISTORY、Architecture、Contracts 与领域词汇。

## Checkpoint 1：模型输入合同

- [x] 替换完整 Session Charter，同时保持 Bootstrap section 与证据边界；
- [x] 历史消息投影增加顶层 Camp、可选 true mention、compact offset 和 compact omission；
- [x] 将 Run Notice 构造、投影与 evidence 全量替换为 Run Facts v1；
- [x] 保持 Collaboration State v2、Profile v3、选择与预算逻辑不变。

## Checkpoint 2：Clean break 与共享合同

- [x] AgentRun Formatter 升至 v17、ContextManifest Evidence 升至 v15；
- [x] 数据合同迁移删除不兼容技术状态并以 Run Fact 字段重建 ContextManifest；
- [x] TypeScript view、共享 fixture 与 Rust binding contract 同步新版本；
- [x] 不保留旧 Notice reader、旧 formatter reader 或双写路径。

## Checkpoint 3：验证与交付

- [x] 覆盖 Charter 精确文本、section 顺序、字段省略和各 Run Fact 触发组合；
- [x] 覆盖中文、emoji、组合字符 continuation 往返及前缀外 mention；
- [x] 通过 migration、Rust workspace、fmt、Clippy、TypeScript 与文档治理；
- [x] 提交、合入并推送 main，确认远端祖先关系后清理 worktree。

## 自动验收证据

- `cargo test -p rovai-core context::tests --lib`：38 passed；
- `pnpm test:rust:full`：Core library 485 passed，CLI 12 passed，Main 79 passed，3 个手工真实
  Runtime smoke 按定义 ignored；
- `cargo fmt --all -- --check` 与 `cargo clippy --workspace --all-targets -- -D warnings`：通过；
- `pnpm typecheck`：通过；
- `pnpm test`：文档测试 21 passed，Vitest 51 files / 359 tests passed，Node 协议与验收 186 passed；
- `pnpm docs:adr:generate --check`、`pnpm docs:check`、带固定 base 的 `pnpm docs:check:ci`：通过；
- `git diff --check`：通过。

未执行真实 Runtime、Desktop 或打包验收；本版本不改变 Renderer、Runtime adapter、打包或真实 Runtime
能力，相关 smoke 仍按仓库约定保留为手工测试。
