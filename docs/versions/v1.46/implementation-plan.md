---
document_type: implementation-plan
version: v1.46
authority: implementation-and-acceptance-status
status: in_progress
last_updated: 2026-09-05
---

# v1.46 实施与验收

## 实施范围

- [x] 为路由 mutation 建立“同步锁定 → flush → Core mutation → content 变化时 authoritative replace → 解锁”。
- [x] 简化发送为锁定后的 exact-revision flush/send/load/replace，删除发送持久化 hold、epoch advance 和版本清空分支。
- [x] 在 Camp 激活入口注册离开 guard，flush 失败时阻断切换；删除 Composer cleanup 中的异步 flush。
- [x] 区分 Draft loading/ready/error，删除读失败伪造 revision-zero Draft，并提供禁用态和显式重新加载。
- [x] 让 Typeahead critical-priority Enter/Tab 从当前 Lexical selection 同步重算 bounded trigger。
- [x] 关闭 Composer spellcheck；autosave 单次导出、直接线性比较、正文保存投影抑制、错误单独上报和附件批量单 flush。
- [x] 完成全量 TypeScript、Vitest、桌面构建和本地文档治理门禁。
- [ ] 完成 PR CI 并合入 `main`。

## 验收矩阵

| Gate | 状态 | 证据 |
| --- | --- | --- |
| Composer / App / Workspace 定向回归 | `passed` | 定向 Vitest 6 files / 192 tests 通过，覆盖直接比较、single-flight/error、mutation kind、Camp switch 判定、spellcheck 与 Typeahead Enter 决策 |
| TypeScript、全仓 Vitest 与桌面构建 | `passed` | `pnpm typecheck`；`pnpm test` 中 149 files / 1508 Vitest tests 与 220 Node tests 通过、1 项既有 Windows-only skip；`pnpm build:desktop` 通过 |
| Native Composer fixture | `environment-blocked` | fixture Vite production build 通过；本机 Electron assertion 被已识别的 macOS nested-sandbox capability gate 明确跳过，交由 PR CI 的可运行环境执行 |
| 文档治理 | `passed` | `docs:test` 9 项、`docs:check` 与基于 `7b1d2b4b58afcde96553a87ac97a03793d31be08` 的 diff-aware `docs:check:ci` 通过 |
| PR CI 与合入 | `pending` | 等待远端检查与合入结果 |

## 完成条件

- Core route mutation 改变 V2 content 后，Lexical 在解锁前完成 authoritative replacement；只改 revision/附件时不替换。
- send、routing 和 Camp switch 在任何异步等待前锁定 Lexical；send failure 保留 Draft，switch flush failure 不离开。
- Draft load error 没有 revision-zero fallback，且用户无法编辑、附加、路由或发送，重试成功后才进入 ready。
- Typeahead Enter 不依赖 React menu render；loading/候选/空候选三条同步分支有回归证据。
- save_content 不驱动 Workspace 投影 render，普通保存状态不提升到 Workspace，批量附件只做一次正文 flush。
- 全量自动化、构建、文档治理和 PR CI 通过后才能把本版本标记 `complete`。
