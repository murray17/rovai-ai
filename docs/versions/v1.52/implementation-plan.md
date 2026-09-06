---
document_type: implementation-plan
version: v1.52
authority: implementation-and-acceptance-status
status: complete
last_updated: 2026-09-06
---

# v1.52 实施与验收

## 实施范围

- [x] 扩展 `ResolvedFilePreview` 成功结果，允许返回可选且既有类型的 `RestoreFilePreviewRequest`。
- [x] Main 在合格 child 成功打开后独立取得当前 Camp workspace 根，并形成可逆的 root-relative 引用。
- [x] workspace authority 不可用、目标越界或引用有歧义时安全省略字段，同时保留既有当前预览结果。
- [x] 在异步 workspace 投影后再次检查 Main binding generation，再注册与发布 handle。
- [x] Renderer 安装时优先使用 Main 稳定来源，阻止后来的临时 child 覆盖同一 Tab 的业务来源。
- [x] 以 `previewKey` 与 Main 确认的项目相对 source key 复用冷 Tab 的稳定 ID。
- [x] 保留外部／临时 child、业务来源身份、restore 副作用和失败内容态的既有边界。
- [x] 增加父释放／删除、A→B→C、冷 Tab 去重、稳定来源保留、外部来源和 A→B→A stale result 回归。
- [x] 完成全仓 Vitest、Desktop build、UI 检查和文档治理门禁。

## 验收重点

- `docs/README.md` 中打开 `./design.md` 后，成功结果携带相对 workspace 根的 `docs/design.md`，不携带父目录相对值；
- 父文件 handle 被释放或父文件被删除后，切换 Camp 再返回仍能以子文件自己的来源恢复；
- A→B→C 每层都获得直接 `camp_workspace` locator，不形成父链或延长父能力；
- 同一项目文件从不同入口或冷 Tab 打开时复用稳定 ID，后来的临时 child 不覆盖稳定业务 source；
- 子文件删除后恢复返回 `file_not_found`，内容区仍只有居中轮廓与“找不到这个文件”；
- 外部／临时／Root Grant child、系统应用格式与旧 binding generation 不获得稳定来源、权限或原生副作用；
- `message_reference`、`attachment` 与 `run_evidence` 保留原来源身份和重验语义。

## 必跑命令

```bash
pnpm exec vitest run apps/desktop/src/renderer/src/file-preview-session.test.ts apps/desktop/src/renderer/src/FilePreviewTabs.test.ts apps/desktop/src/main/file-preview/file-preview-authority.test.ts apps/desktop/src/main/file-preview/file-preview-ipc-input.test.ts apps/desktop/src/file-preview-reference.test.ts apps/desktop/src/main/file-preview/file-preview-service.test.ts apps/desktop/src/main/file-preview/file-preview-watchers.test.ts
pnpm typecheck
pnpm test
pnpm build:desktop
pnpm test:file-preview-layout
pnpm docs:test
pnpm docs:check
DOCS_BASE_REF=<merge-base-with-main> pnpm docs:check:ci
git diff --check
```

## 最终验证记录

- File Preview authority、reference、IPC input、Main service、watcher、Renderer session 与 Tabs 定向回归：7 个文件、
  80 个用例通过；
- `pnpm typecheck` 与 `pnpm build:desktop` 通过；
- `pnpm test` 通过：Vitest 154 个文件、1566 个用例通过；Node 220 个用例通过，1 个仅限 Windows 的用例跳过；
- `pnpm test:file-preview-layout`、`pnpm test:desktop-bridge` 与 `pnpm test:file-reference-navigation` 已执行，但本机
  嵌套 macOS sandbox 阻止 Chromium sandbox 初始化，原生业务断言明确跳过且不计为通过；本版本没有改变 File
  Preview 布局、Preload channel 或链接点击行为，相关 TypeScript、Main/Renderer 定向回归和生产构建均通过；
- `pnpm docs:test`、`pnpm docs:check`、
  `DOCS_BASE_REF=6bed8dea125710c0ccb0853a7bc613ec0b0c5e73 pnpm docs:check:ci` 与 `git diff --check` 通过。
