---
document_type: implementation-plan
version: v1.51
authority: implementation-and-acceptance-status
status: complete
last_updated: 2026-09-06
---

# v1.51 实施与验收

## 实施范围

- [x] 建立按 Camp 隔离、有界且只存于窗口内存的文件预览 session store。
- [x] 以稳定 Tab ID、可重验业务 source 和安全呈现恢复 shell，排除全部临时能力与旧内容。
- [x] Camp commit 先绑定 Main；可见 active 文件自动恢复，后台文件按首次激活惰性恢复。
- [x] 增加 typed `RestoreFilePreviewRequest`、Preload API、独立 IPC parser 与 Main restore policy。
- [x] 为 Renderer Camp scope／Tab request 和 Main Camp binding 分别增加 generation fence。
- [x] Camp 永久删除清理快照；Pane 隐藏、Tab 关闭和 File Change 历史语义保持独立。
- [x] 把文件失败内容区收敛为通用文件轮廓与一句公开文案，不改变其他界面视觉。
- [x] 增加 session store、失败呈现、无副作用恢复和 A→B→A 竞态回归。
- [x] 完成全仓 Vitest、Desktop build、UI 检查和文档治理门禁。

## 验收重点

- A 打开多个文件并调整顺序／选择／Pane 可见性，切到 B 后再回 A，shell 精确恢复且只有可见 active 文件立即读取；
- 关闭 Pane 后切换不自动读取；重新展开或首次激活 cold Tab 才重验 source；关闭的 Tab 不再恢复；
- 快照和恢复请求不携带 handle、reopen token、Root Grant、challenge、Blob URL、正文、文件尺寸或旧 `previewKey`；
- 恢复缺失、失效或变化后的来源停留在原 Tab，并显示错误码对应的单句状态；不会弹选择器、确认框或启动系统应用；
- child/root 临时来源明确 unavailable；File Change 历史 detail 仍按原 AgentRun/epoch/evidence ID 获取；
- A→B→A 的旧 Renderer promise 和旧 Main binding 即使最终成功，也不能安装内容、注册 handle 或执行原生效果；
- 删除 Camp 后其快照不可由离开 effect 复活；缓存长期使用仍保持有界；
- 失败内容态之外的会话布局、文件 Tabs、Viewer、操作区和动效不发生视觉改造。

## 必跑命令

```bash
pnpm exec vitest run apps/desktop/src/renderer/src/file-preview-session.test.ts apps/desktop/src/renderer/src/FilePreviewTabs.test.ts apps/desktop/src/main/file-preview/file-preview-ipc-input.test.ts apps/desktop/src/main/file-preview/file-preview-service.test.ts apps/desktop/src/main/file-preview/file-preview-watchers.test.ts
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

- session store、失败呈现、restore IPC、Main service 与 watcher 代次定向回归：5 个文件、69 个用例通过；
- `pnpm typecheck` 通过；
- `pnpm test` 通过：Vitest 154 个文件、1557 个用例通过；Node 220 个用例通过，1 个仅限 Windows 的用例跳过；
- `pnpm build:desktop` 通过；独立 file-preview-layout Renderer fixture 构建通过；
- `pnpm test:file-preview-layout` 已执行，但本机嵌套 macOS sandbox 阻止 Chromium sandbox 初始化，原生业务断言明确
  跳过且不计为通过；浏览器隔离 fixture 补充确认缺失文件状态只有 32px 轮廓图标与一句文案，无路径、按钮、边框或
  内部详情，横纵居中误差均小于 0.01px；
- `pnpm docs:test`、`pnpm docs:check`、`DOCS_BASE_REF=e754a483608049b07ad412f147ea9cec15981e2f pnpm docs:check:ci`
  与 `git diff --check` 通过。
