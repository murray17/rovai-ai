---
document_type: version-decisions
version: v1.13
lifecycle: current
last_updated: 2026-08-19
---

# v1.13 决策记录

本文件只解释 v1.13 的重要取舍；当前字段与行为规范由 Architecture、Contracts 和 UI 文档直接拥有。

<a id="v1-13-d01"></a>

## V1.13-D01：配置策略与单次 Run 实际模型观测分离

### 背景

`MemberRuntimeConfiguration` 保存的是队员后续运行使用的模型策略；`runtime_default` 刻意不向 Runtime 发送
显式模型。模型目录与保存配置因此都不能证明某次 AgentRun 实际使用了什么模型。执行台若始终只显示
“Agent 运行时默认”，用户无法解释当前 Run；若从请求、目录或 usage 推断，又会把意图或候选误报成事实。

### 决定

为每个 `runtime_default` AgentRun 接受一个 Runtime-native、结构化且可归因到当前 Session/Thread 的模型
观测。Codex、七个 ACP Runtime、Claude Code 与 Antigravity 分别在其真实原生边界采集，不扫描自由文本，
不使用目录默认值、请求参数或保存配置兜底。

Core 只在 `agent_run_id + execution_epoch` 匹配、模型来源仍为 `runtime_default` 且尚无观测时写入。第一个
可信模型成为该 Run 的 write-once 展示事实；后续同值、不同值或中途换模均不覆盖。固定模型不进入本版
额外展示。没有观测时 Renderer 继续显示“Agent 运行时默认”；采集或持久化失败不改变 Run 终态。

### 后果

- 成员配置继续表达未来执行策略，单次 Run observation 只表达该 Run 的实际展示事实；
- 十种 Product Runtime 共享一个 Read Model 与 Renderer shape，但保留各自原生证据 seam；
- 新 nullable 列需要 Data Contract v1.13、projection schema 51 与 migration 96；
- Renderer 可以在不增加第二套 UI 的情况下从默认标签自然收敛到实际模型；
- 当前合同明确不承诺 Run 内模型切换历史或固定模型的额外标签。

### 被拒绝方案

- 从 model catalog default、请求参数或冻结配置直接展示：这些是候选或意图，不是实际执行证据；
- 从 Usage summary、assistant 文本或日志猜测：无法可靠归因，且可能泄露或误判；
- 每次观测都覆盖并展示最新模型：会引入当前范围不需要的中途换模状态机；
- 观测不到就隐藏模型字段：会使默认策略在不同 Runtime 间产生不稳定布局和含义；
- 同时展示固定模型：用户已明确排除，且不需要本版新增 Run-local 重复信息。

### 当前权威影响

- [Runtime Catalog Boundaries](../../architecture/runtime-catalog-boundaries.md)
- [Runtime 基础不变量](../../architecture/foundational-invariants.md#runtime-catalog-installation)
- [Run Process Detail Surface v11](../../contracts/run-process-detail-surface-v11.md)
- [Camp Open Projection v3](../../contracts/camp-open-projection-v3.md)
- [Camp 会话工作区](../../ui/components/conversation-workspace.md)
