---
document_type: implementation-plan
version: v1.43
authority: implementation-and-acceptance-status
status: complete
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
DOCS_BASE_REF=<merge-base-with-main> pnpm docs:check:ci
git diff --check
```

## 验证记录

- [x] Composer 文档、EditorState、Draft Sync 与组件定向 Vitest：4 files / 25 tests 通过。
- [x] `pnpm test` 通过：147 个 Vitest 文件、1491 个用例；Node 套件 220 个通过、1 个 Windows-only 跳过。
- [x] Rust format、workspace/all-targets check、CLI 32 项与 feature-gated slow-tests 300 项通过；默认库测试在排除下述宿主能力单例后 495/495 通过。
- [x] `pnpm build:desktop`、`pnpm docs:test`、`pnpm docs:check`、以 `3d858d00deffe5bd1299846fd28df498d49af0b9` 为 merge-base 的 diff-aware 文档门禁及 `git diff --check` 通过。
- [x] Impeccable changed-target 扫描未命中本次 Composer TSX/CSS 变更；报告项均位于未修改的既有全局 CSS 规则。
- [ ] 当前受管执行环境禁止嵌套 macOS sandbox：`pnpm test:desktop:integration` 的 10 个 Electron 业务夹具均按统一预检明确标记为 `BLOCKED`，没有把 skip 计作通过；Rust `managed_process` sandbox 能力单例同因 `/usr/bin/sandbox-exec` exit 71 阻断。需由普通 Terminal 或 CI host 完成这两项宿主能力验收。
- [ ] 严格 all-features Clippy 命中未修改基线：`context.rs:1715` 的 `type_complexity` 与 `db.rs:26063` 的 `no_effect_replace`；本版本未把无关基线整改混入 Composer 改动。
