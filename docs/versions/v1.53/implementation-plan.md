---
document_type: implementation-plan
version: v1.53
authority: implementation-and-acceptance-status
status: complete
last_updated: 2026-09-06
---

# v1.53 实施与验收

## 实施范围

- [x] 为 Runtime 图片观察增加可选、闭集的 Adapter 确认公屏来源，不从工具名、路径或格式推断。
- [x] Codex 原生 `imageGeneration` 与 Antigravity 已完成精确 step 分别写入唯一允许来源。
- [x] Claude、Codex MCP、ACP、TRAE 与 Copilot 图片继续保留观察和存储，但不写入公屏来源。
- [x] Migration 141 增加 nullable `public_display_source`，旧行保持 `NULL`，DDL、marker 与 receipt 原子提交。
- [x] 在 `list_camp_images` 单一 Core 投影 seam 过滤闭合集，保持 Snapshot/Open/实时刷新/重开共用语义。
- [x] 保留 Camp-scoped bytes 读取、底层行、Blob GC root、稳定路径及显式 CampMessage 图片附件行为。
- [x] 增加 CUA 截图、两类原生生图、工具名伪装、历史保留、闭集约束及迁移原子性回归。
- [x] 更新 Runtime Images、Camp Open、Architecture、UI 和版本治理文档。

## 验收重点

- `mcp__cua_repl/js` 的 Codex MCP image 仍能保存，但 `agentRunImages` 为空，因而不能成为消息图片区或独立兜底；
- Codex `item/completed + imageGeneration` 和 Antigravity 精确 done generate-image step 仍进入公屏集合；
- Claude `tool_result`、ACP `content:image`、TRAE Read、Copilot view-image 与名为 `generate_image` 的第三方工具
  均保持未确认来源；
- 历史 `agent_run_image` 行升级后保留且来源为 `NULL`，不会按旧 toolCallId、文件名或路径重新分类；
- 同一来源过滤同时覆盖实时刷新、Snapshot/Open、重新进入 Camp、公开消息合并与终态无消息兜底；
- `rovai send --file` 显式图片附件、同摘要显式附件优先和按需读取授权不变。

## 必跑命令

```bash
cargo test -p rovai-core --lib agent_run_image::tests
cargo test -p rovai-core --lib db::tests::current_migration_state_admission_matrix -- --exact
cargo test -p rovai-core --lib db::tests::v141_retains_historical_runtime_images_as_unconfirmed -- --exact
cargo test -p rovai-core --lib db::tests::v127_preserves_saved_bindings_and_introduces_no_fast_override -- --exact
cargo test -p rovai-core
pnpm typecheck
pnpm test
pnpm docs:test
pnpm docs:check
DOCS_BASE_REF=<merge-base-with-main> pnpm docs:check:ci
cargo fmt --all -- --check
git diff --check
```

## 最终验证记录

- Runtime 图片 6 个定向用例通过，覆盖 Adapter 来源、CUA 截图隐藏、两类原生生图、存储/读取、限额、显式附件
  去重与路径生命周期；
- Migration 141 的准入矩阵、历史行保留、闭集约束、receipt failure 回滚和完整迁移链定向用例通过；
- `cargo test -p rovai-core` 通过：Library 508、CLI 33、Main 221 个用例通过，5 个手动真实 Runtime smoke 忽略；
- `pnpm test` 通过：Vitest 154 个文件、1566 个用例通过，最终 Node 批次 220 个通过、1 个 Windows-only 用例跳过；
- `pnpm typecheck`、`pnpm docs:test`、`pnpm docs:check`、
  `DOCS_BASE_REF=91af2eeebd7ebfb581820c2f68d259ff51497199 pnpm docs:check:ci`、
  `cargo fmt --all -- --check` 与 `git diff --check` 通过。
