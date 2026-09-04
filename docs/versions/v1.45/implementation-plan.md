---
document_type: implementation-plan
version: v1.45
authority: implementation-and-acceptance-status
status: complete
last_updated: 2026-09-04
---

# v1.45 实施与验收

## 实施范围

1. 以独立 Coordinator 收口完整 Draft authority 和所有 expected-revision mutation。
2. 把 Draft Sync 收窄为本地 EditorState/version/dirty/epoch/persistence status，并建立有限重试和显式 flush 失败。
3. 调整发送冻结、成功清空和下一 Draft epoch，保留发送期间的新输入。
4. 把 Atom 从 token TextNode 改为 identity-only inline DecoratorNode，并补齐 NodeSelection Clipboard。
5. 用一个自定义 React Plugin 替换两套标准 Typeahead，限定 128 字符 source window 和结构边界。
6. 删除旧完整 Draft refs/result caches 与标准 Typeahead 全前缀读取路径，更新当前权威文档。

## 验收矩阵

| Gate | 状态 | 证据 |
| --- | --- | --- |
| Coordinator revision/queue/epoch/failure 单元测试 | `passed` | `draft-mutation-coordinator.test.ts` 的 5 个测试覆盖串行 revision、排队 reload、no-op flush、stale epoch 与失败刷新 |
| Draft Sync debounce/single-flight/error/retry/epoch 单元测试 | `passed` | `composer-draft-sync.test.ts` 覆盖 autosave、send hold、有限退避与 authoritative result late read |
| Atom/serialization/Clipboard 单元测试 | `passed` | `composer-editor-state.test.ts` 覆盖 Decorator identity round-trip、换行、NodeSelection 与尾随空格 |
| Trigger boundary 单元测试 | `passed` | `composer-trigger.test.ts` 覆盖 128 字符 read request、URL/path 负例、Atom/LineBreak 与精确替换 |
| Renderer TypeScript、Vitest 与 fixture build | `passed` | `pnpm typecheck`；全仓 149 个 Vitest suite、1504 个 test；独立 Composer fixture Vite build 通过 |
| 原生 Composer/Continuation Electron | `blocked` | 当前嵌套 macOS sandbox 阻止 Chromium sandbox 初始化；按仓库规则不是通过结果，等待 CI/非嵌套主机执行 |
| 全仓测试、生产构建与文档治理 | `passed` | `pnpm test`、`pnpm build:desktop`、`pnpm docs:test`、`pnpm docs:check` 与 diff-aware `docs:check:ci` 均通过 |

## 完成条件

- Renderer 中不存在 `composerDraftRef`、per-Camp Draft queue、`ComposerDraftSync.latestResult` 或标准
  `LexicalTypeaheadMenuPlugin` 路径。
- 所有 Draft mutation 从 Coordinator 当前 revision 发起；flush/send 返回并使用队列结束后的 authority。
- Catalog presentation 不改内容版本；Atom 内无动态显示文本；触发查询只分配有界 suffix。
- 自动化、构建、文档门禁和 PR CI 通过；原生 Electron 若因环境阻断，必须如实保留 blocked 证据并由 CI 补证。
