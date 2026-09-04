---
document_type: implementation-plan
version: v1.43
authority: implementation-and-acceptance-status
status: in_progress
last_updated: 2026-09-04
---

# v1.43 实施与验收

## 已实现

- [x] TypeScript/Rust `ComposerDocument` V2、严格校验、相邻文本归一、统一纯文本投影，以及旧 user-authored
  Structured Content 单向读取转换；Draft/Pending 只写 V2。
- [x] 全部 Lexical 包以精确 `0.50.0` 锁定；稳定 `RovaiComposerExtension` 组合 Plain Text、History、Atom、
  command、clipboard、draft sync 与 React Typeahead。
- [x] 单一 token/unmergeable `ComposerAtomNode` 支持 member、all_members、skill，轻量 DOM、不可拆分删除、
  identity/presentation 分层及 Catalog 局部刷新。
- [x] `@` Member 与 `/` Skill 局部 Typeahead，128 字符硬上限、命令边界、尾随空格复用和 composition guard。
- [x] Plain Text/结构化 MIME/HTML 降级/File 优先 Clipboard，以及不可恢复引用转普通可见文本。
- [x] local version、350ms debounce、1500ms max-wait、single-flight、explicit flush、send version hold 与
  authoritative replacement 边界。
- [x] Camp 与 Pending Composer 迁入非受控 Lexical owner；移除旧全文 transform、DOM ownership snapshot、
  手工 selection mapping、逐字符 Core Draft 更新与常规 remount。

## 验收重点

- 普通按键路径不做 O(N) 全文操作、React 正文 state 更新或 Core IPC；Atom 数量不增加 React Root。
- Markdown 字符保持普通文本；Shift+Enter 产生 `LineBreakNode` 并导出 `\n`，IME 中 Enter 不发送。
- Atom 一次整体删除；Member/Skill trigger 不跨 Atom、换行、非法边界或 128 字符上限。
- Catalog 重命名/失效只改展示，不增加 local version、Draft revision 或 undo item，且 identity 不重绑。
- Clipboard closed schema 拒绝未知字段/非法 identity；纯文本与 HTML 不恢复 Atom；File 先进入附件入口。
- save single-flight 不并发、max-wait 可达；发送期间新输入不会被旧发送成功清空。
- 旧 Draft/Pending 数组可读，下一次写回 V2；`body` 与公开 Message 都从 V2 权威内容统一派生。

## 必跑命令

```bash
cargo fmt --all -- --check
cargo check --workspace --all-targets
cargo test -p rovai-core --lib
pnpm typecheck
pnpm test:composer-input
pnpm test:desktop:integration
pnpm test
pnpm build:desktop
pnpm docs:test
pnpm docs:check
DOCS_BASE_REF=5b03f56177426604780403d92d08a7456af6a1cf pnpm docs:check:ci
git diff --check
```

## 验证记录

- [x] Composer 文档、EditorState、Draft Sync 与组件定向 Vitest：4 files / 24 tests 通过。
- [x] 隔离 Electron 原生输入 fixture：Member/Skill、IME、历史、Clipboard、HTML 降级和 File 优先共 23 项通过。
- [ ] Rust/TypeScript/完整仓库、Desktop integration、build、文档治理与 UI changed-target detector 全量门禁待最终运行。
