---
document_type: implementation-plan
version: v1.49
authority: implementation-and-acceptance-status
status: complete
last_updated: 2026-09-05
---

# v1.49 实施与验收

## 实施范围

- [x] 扩展 `AppQuitCoordinator`：Renderer preparation 成功后才 drain；准备失败结束本次 quit 并允许重试。
- [x] 建立 Main→Preload→Renderer 的一次性响应通道，不向 Renderer 暴露 Core shutdown authority。
- [x] App 注册薄 `prepareForAppQuit()`，只复用匹配 active Camp 的现有 `CampLeaveGuard`。
- [x] 让 Windows/Linux 主窗口 close 在 Renderer 销毁前进入同一退出 coordinator，保留 macOS 关窗语义。
- [x] 将文件预览与其他服务收口留到 Renderer preparation 成功后的既有 drain。
- [x] 增加 quit 顺序、重复请求、准备失败重试、桥响应和 active-Camp guard 定向回归。
- [x] 扩展 packaged Planned Shutdown 验收：最后一段 Lexical 输入后立即退出，重启读取完整 Core Draft。
- [x] 完成 TypeScript、全仓 Vitest、桌面构建、脚本语法与文档治理门禁。

## 验收矩阵

| Gate | 状态 | 证据 |
| --- | --- | --- |
| Quit coordinator / bridge / Renderer guard 定向回归 | `passed` | 3 files / 167 tests 通过 |
| TypeScript | `passed` | `pnpm typecheck` 通过 |
| 全仓 Vitest 与桌面构建 | `passed` | 150 files / 1516 tests 通过；`pnpm build:desktop` 的 Main、Preload、Renderer 三段构建通过 |
| Packaged Planned Shutdown Draft 验收 | `not-run` | 脚本已扩展；需要本机 packaged App 与真实已认证 Runtime，不进入普通门禁 |
| 脚本、文档治理与 diff hygiene | `passed` | `node --check scripts/accept-planned-shutdown.mjs`、`docs:test` 9 项、`docs:check`、差异感知 `docs:check:ci` 与 `git diff --check` 通过 |

## 完成条件

- 当前 active Composer 的最后一个 Lexical EditorState 在任何 Core shutdown admission 关闭前成为 Core Draft authority。
- 准备失败不调用服务 drain、`core.shutdown()` 或 `app.exit()`，并保留当前 Camp、正文、错误与可重试交互。
- 成功退出继续只调用一次既有 Planned Shutdown；Renderer 不获得进程关闭或 AgentRun 取消 authority。
- 无 active/matching Camp 时准备 no-op；重复 quit 不产生第二轮 preparation 或 drain。
- 既有 shutdown overlay 的触发、延时、文案和视觉结构不变。
- 自动化、构建与文档门禁通过；真实 packaged 验收若未运行必须明确记录，不能声称通过。
