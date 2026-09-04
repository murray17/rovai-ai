---
document_type: implementation-plan
version: v1.47
authority: implementation-and-acceptance-status
status: complete
last_updated: 2026-09-05
---

# v1.47 实施与验收

## 实施范围

- [x] 建立薄 `leaveActiveCamp()`，复用已注册 `CampLeaveGuard`，保存失败不执行 transition。
- [x] 让 Camp→Camp 与 Camp→设置、记忆、队员共享统一 leave preparation/completion 语义。
- [x] 让移除当前 Project 后返回快速对话的卸载路径先经过同一 guard。
- [x] 保持创建 Dialog、Project 展开/选择等不卸载 Composer 的交互不触发伪 leave；真正激活新 Camp 时再 guard。
- [x] 保留附件等待、Composer flush、Coordinator idle、Pending 收尾和 clean Draft no-op revision 语义。
- [x] 增加 leave 判定、成功 transition、未离开 completion 和 transition failure 的定向回归。
- [x] 完成全量 TypeScript、Vitest、桌面构建和文档治理门禁。
- [x] 完成 PR #231 CI；本版本随该 PR 合入 `main`。

## 验收矩阵

| Gate | 状态 | 证据 |
| --- | --- | --- |
| App / Camp Workspace 定向回归 | `passed` | `App.test.ts` 159 项通过，覆盖 active Surface 判定、Camp transition、未离开解锁与 transition failure |
| TypeScript、全仓 Vitest 与桌面构建 | `passed` | `pnpm typecheck`、149 files / 1510 Vitest tests、220 Node tests 通过（1 项既有 Windows-only skip），`pnpm build:desktop` 通过 |
| 文档治理 | `passed` | `docs:test` 9 项、`docs:check` 与基于 `b47882369b7e22d82ab589e29f31a065ab09f9cd` 的 diff-aware `docs:check:ci` 通过 |
| PR CI 与合入 | `passed` | PR #231 的 GitHub `gate` 首轮通过；本完成状态随该 PR 的最终检查与合并进入 `main` |

## 完成条件

- 任何普通 transition 真正卸载或替换当前 Camp Composer 前，现有 guard 已完成附件等待、flush 与 Coordinator idle。
- guard 失败时 transition 未执行，当前 Camp、Lexical 内容与交互恢复均可重试。
- transition 失败或动作没有实际离开当前 Composer 时调用 `complete(false)`；真正离开时调用 `complete(true)`。
- Pending Camp 收尾仍在 `CampWorkspace` guard 内，App 不复制 Draft 或 Pending 领域逻辑。
- 打开创建 Dialog、切换 Project 展开上下文等不卸载动作不产生不必要的 leave transaction。
- 全量自动化、构建、文档治理和 PR CI 通过后才能把本版本标记 `complete`。
