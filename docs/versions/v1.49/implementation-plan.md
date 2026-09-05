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
- [x] 补齐 macOS close-only fence：复用 preparation，成功只关窗，失败可重试，重叠 Cmd+Q 共享 preparation。
- [x] 将文件预览与其他服务收口留到 Renderer preparation 成功后的既有 drain。
- [x] 增加 quit 顺序、重复请求、准备失败重试、桥响应和 active-Camp guard 定向回归。
- [x] 扩展 packaged Planned Shutdown 验收：最后一段 Lexical 输入后立即退出，重启读取完整 Core Draft。
- [x] 完成 TypeScript、全仓 Vitest、桌面构建、脚本语法与文档治理门禁。
- [x] 按维护者已完成的三平台目标主机验收与发布确认，把 Pi 的 macOS arm64、macOS x64、Windows x64 行分别
  绑定 adapter-scoped immutable evidence 并晋升为 `qualified`；移除 Pi 专属实验性文案，保留通用 Preview 状态。

## 验收矩阵

| Gate | 状态 | 证据 |
| --- | --- | --- |
| Quit coordinator / bridge / Renderer guard 定向回归 | `passed` | 3 files / 167 tests 通过 |
| TypeScript | `passed` | `pnpm typecheck` 通过 |
| 全仓 Vitest 与桌面构建 | `passed` | 150 files / 1516 tests 通过；`pnpm build:desktop` 的 Main、Preload、Renderer 三段构建通过 |
| Packaged Planned Shutdown Draft 验收 | `not-run` | 脚本已扩展；需要本机 packaged App 与真实已认证 Runtime，不进入普通门禁 |
| Pi 三平台准入 | `passed` | 维护者确认三平台目标主机验收完成；三份 platform-scoped evidence digest、Core closed matrix 与 Renderer projection 同步 |
| 脚本、文档治理与 diff hygiene | `passed` | `node --check scripts/accept-planned-shutdown.mjs`、`docs:test` 9 项、`docs:check`、差异感知 `docs:check:ci` 与 `git diff --check` 通过 |

## 完成条件

### macOS 独立关窗补齐验证

- Main 只增加 close handler 与现有 preparation 的 per-window in-flight 合并；不修改 Core、Renderer Draft 模型或 shutdown coordinator。
- 定向 Vitest：4 files / 174 tests 通过，覆盖等待保存、连续关窗、保存失败重试、延后 native close、窗口已销毁及两种顺序的 Cmd+Q 重叠。
- 全仓 Vitest：151 files / 1523 tests 通过；TypeScript、Main/Preload/Renderer 构建、脚本语法和差异感知文档门禁通过。
- 原生 Electron close/reopen 夹具通过 `pnpm test:window-close` 加入隔离 Electron 集成套件；本机因 nested macOS sandbox 明确 `blocked/skipped`，未声称原生窗口验收通过。
- 完整 `pnpm test` 的 Node 部分为 219 passed / 1 failed / 1 skipped。唯一失败是基线已有的
  `scripts/benchmark/protocol/product-contract.test.mjs` 仍断言 v1.48，而基线版本指针已是 v1.49；本次不修改该 Benchmark 测试或版本指针。

### 行为条件

- 当前 active Composer 的最后一个 Lexical EditorState 在任何 Core shutdown admission 关闭前成为 Core Draft authority。
- 准备失败不调用服务 drain、`core.shutdown()` 或 `app.exit()`，并保留当前 Camp、正文、错误与可重试交互。
- 成功退出继续只调用一次既有 Planned Shutdown；Renderer 不获得进程关闭或 AgentRun 取消 authority。
- 无 active/matching Camp 时准备 no-op；重复 quit 不产生第二轮 preparation 或 drain。
- 既有 shutdown overlay 的触发、延时、文案和视觉结构不变。
- 自动化、构建与文档门禁通过；真实 packaged 验收若未运行必须明确记录，不能声称通过。

### Pi 平台准入条件

- 三个 shipped platform 均返回 `qualified / reasonCode=null`，且 evidence revision 分别绑定精确平台 artifact。
- Pi 成员选项与 Settings 行不显示“实验性”或“实验性开放”；其他未来 `preview` Runtime 仍按通用合同披露。
- 晋升不跳过安装、版本、认证、模型、Session、Deep Probe 或 Dispatch Preflight，也不新增 External MCP、Web Search、
  Fast、Approval 或 sandbox 能力。
