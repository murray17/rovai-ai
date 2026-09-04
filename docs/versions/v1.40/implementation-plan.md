---
document_type: implementation-plan
version: v1.40
authority: implementation-and-acceptance-status
status: complete
last_updated: 2026-09-04
---

# v1.40 实施与验收

## 已实现

- [x] Migration 137 原子增加四个 source-ref JSON array owner 字段，不迁移旧 Prepared 数据。
- [x] Core closed `LocalAttachmentSourceRef`、UUID identity、严格 UTF-8 absolute path、无路径 View 与 exact owner locator。
- [x] native path 直接进入 Core；bytes/Blob 只写 OS Temp，Core 接受后不主动清理。
- [x] Composer 新附件完全绕过 Prepared/Managed/Message Attachment 表与长期 attachment directory；支持纯附件。
- [x] Composer 在执行中或队列非空时把完整 source-ref 意图原子写入 Pending 并消费 exact Draft。
- [x] Pending View、working refs、添加/粘贴/拖放、删除、排序、Save/Cancel/Delete 和附件-only 保存。
- [x] Pending 队首发布前 exact availability 检查、三种 `needs_repair` 错误和 FIFO 阻断。
- [x] CampMessage 保存 source refs；Camp Open/History 使用 storage-blind View 且数据库读取不访问文件系统。
- [x] preview/open/reveal 覆盖 Composer、Pending、Pending Edit 与 Message owner，只在动作时解析路径。
- [x] Core Run resolver canonical containment：executionRoot 内直读，外部普通复制至当前 Run Temp；Adapters wire 不变。
- [x] 旧 Prepared Draft 保持互斥 legacy 模式并自然耗尽；Agent ingress、Agent 产物和历史 Managed/legacy 继续兼容。
- [x] Renderer 删除 queue 对选择、粘贴与拖放的附件阻断，增加 Pending 附件展示和编辑操作。

## 验收重点

- 新用户 source ref 从 Draft → Pending/Message 全程没有四类 legacy/Managed 表写入，也不创建 `camp-attachments`。
- immediate source 不可用时不建 Message且保留 Draft；Pending head 写 exact repair code 并阻塞后继。
- 旧 Prepared Draft 不迁移、不混用；删除最后一个旧附件后才可添加 source ref。
- Message/Draft/Pending/History/View JSON 均不含 `sourcePath`；历史加载对不存在路径仍返回 `unknown`。
- source bytes 修改后仍可发送，证明没有 digest/freeze；Run resolver 对 workspace symlink escape 使用 Run Temp，并拒绝
  外部目录中的 nested symlink/special node。
- `CURRENT_INPUT.attachments` 仍是字符串数组，外部路径在 Runtime 可读的 Run Temp 下，未增加 Adapter policy。

## 必跑命令

```bash
cargo fmt --all -- --check
cargo check --workspace --all-targets
cargo check -p rovai-core --all-targets --features slow-tests
cargo clippy -p rovai-core --all-targets --features slow-tests -- -D warnings
cargo test -p rovai-core --lib
pnpm typecheck
pnpm test
pnpm build:desktop
pnpm docs:test
pnpm docs:check
DOCS_BASE_REF=d2a4967a60900f658d420430e50013f31eee8bd5 pnpm docs:check:ci
```

Electron production fixture tests仍使用隔离临时 `userData`。若宿主在 Chromium 启动阶段返回
`sandbox initialization failed: Operation not permitted`，该结果只能记录为环境阻断，不能冒充业务断言失败或通过。

## 验证记录

- [x] Core source-ref、Pending、Message、History、resolver 与 migration 定向测试通过。
- [x] Desktop Main/Renderer 定向 Vitest 3 files / 202 tests 通过；`pnpm typecheck` 通过。
- [x] 变更 smoke/acceptance `.mjs` 均通过 Node syntax check。
- [x] `cargo fmt --check`、workspace/all-target check、slow-feature check 与 Clippy `-D warnings` 通过；
  `rovai-core` binary 212 tests 通过、5 个 manual Runtime smoke ignored；两条 source/legacy attachment slow test 通过。
- [x] `pnpm typecheck`、`pnpm build:desktop` 与完整 `pnpm test` 通过：145 个 Vitest 文件 / 1532 tests，
  220 个仓库 Node tests 通过、1 个既定 Windows test skipped。
- [x] `pnpm docs:test`、`pnpm docs:check` 与带固定 base 的 `docs:check:ci` 通过。
- [x] Impeccable changed-target detector 已在 UI 改动冻结后运行一次；结果只命中共享样式表既有的侧边强调线与
  width transition 规则，没有命中新附件选择器，本版本不扩张为视觉系统重构。
- [x] `cargo test -p rovai-core --lib` 的 494 项中 493 项通过；唯一失败为既有 macOS sandbox 探针，
  `/usr/bin/sandbox-exec` 在当前宿主以 71 退出。Camp Open、File Preview 与 File Reference Electron fixtures
  同样在 Chromium 业务断言前被宿主 `sandbox initialization failed: Operation not permitted` 阻断；均记录为
  环境限制，不改写产品代码或宣称 E2E 通过。
