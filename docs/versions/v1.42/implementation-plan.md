---
document_type: implementation-plan
version: v1.42
authority: implementation-and-acceptance-status
status: in_progress
last_updated: 2026-09-04
---

# v1.42 实施与验收

## 实施范围

- [x] `SafeMarkdown` 只把显式 Markdown link 转换为本地文件或 Web 资源入口；inline-code、代码块和普通正文保持展示语义。
- [x] 删除消息 inline-code 候选抽取、Renderer resolve Hook、Preload API、IPC 输入与 Main service；Core 只授权显式 destination。
- [x] 保留共享资源视觉类型与 Main classifier 分离；Markdown 与代码两种 Glyph 同时服务消息链接和 Preview Tab。
- [x] 用户 Composer／Timeline 文件卡最大宽度收敛为 220px，长名称省略但保留完整 `title` 与可访问操作名。
- [ ] 完成 TypeScript、Vitest、Desktop build、文档治理、Electron 文件引用/附件夹具和最终 UI 检查。
- [ ] PR CI 全部通过并合入 `main`，远端主线包含最终提交。

## 验收重点

- `[配置](config.toml)`、`[代码](src/App.tsx:20)` 和 HTTPS 链接保留相应图标及既有打开行为；
- `` `config.toml` ``、`` `src/App.tsx:20` ``、普通正文路径与 `/compact` 不产生链接、磁盘访问或 Preview；
- Markdown 资源入口与 `.md` Preview Tab 显示同一折角文档 Glyph，代码入口与代码 Tab 显示同一较大 `</>` Glyph；
- 不支持预览、附件 owner locator、系统应用 fallback、错误结果和 Main classifier 与 v5 相同；
- 长用户附件卡不超过 220px，示例名称约在 `rovai-file-referen…` 处省略，完整名称仍可由 title/辅助技术取得；
- Agent 交付卡、图片附件、文件扩展标签与打开/显示所在位置操作不发生行为漂移。

## 必跑命令

```bash
pnpm exec vitest run apps/desktop/src/renderer/src/FilePreviewTabIcon.test.ts apps/desktop/src/renderer/src/FileReferenceLink.test.ts apps/desktop/src/renderer/src/SafeMarkdown.test.ts apps/desktop/src/renderer/src/FilePreviewTabs.test.ts apps/desktop/src/renderer/src/theme-tokens.test.ts
pnpm typecheck
pnpm test
pnpm build:desktop
pnpm docs:test
pnpm docs:check
DOCS_BASE_REF=<merge-base-with-main> pnpm docs:check:ci
git diff --check
```

## 验证记录

- 待本分支最终实现与 PR CI 完成后填写。
