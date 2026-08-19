---
document_type: version-decisions
version: v1.15
lifecycle: current
last_updated: 2026-08-19
---

# v1.15 决策记录

本文件只解释 v1.15 的重要取舍；当前字段与行为规范由 Architecture、Contracts 和 UI 直接拥有。

<a id="v1-15-d01"></a>

## V1.15-D01：运行中 AgentRun 优先完整过程而非固定事件窗口

### 背景

Camp open 原本只返回 non-terminal AgentRun 最近 80 条 Execution Evidence，Renderer 同时只保留最近 600 个
live Runtime event。Runtime 经常把一段正文拆成逐字符 delta，因此这两个窗口并不等价于 80 或 600 个用户
可理解的步骤；长 Run、中途进入或刷新可能静默缺少早期正文和 Tool chronology。terminal Run 已有稳定分页，
但运行中 Run 没有同等补全路径，与执行台“完整保留 Tool chronology”的当前合同冲突。

### 决定

`camps.enter` 与 `camps.open` 返回当前 Camp 所有 non-terminal AgentRun 的完整 Execution Evidence，不再使用
固定 80 条窗口。Renderer 以稳定 Evidence identity 合并投影和 live event，并取消 600 项滚动裁剪；当前
Main Window Session 内已接收的运行事件全部保留。terminal Evidence、单条大内容 preview 与 Managed Blob
按需全文读取保持原边界。

### 后果

- 运行中过程在首次进入、刷新和持续 streaming 时都能从最早 Evidence 开始检查；
- Camp open 响应和 Renderer live state 随 non-terminal Run 活动量增长，不再承诺固定 Evidence 条目预算；
- 其他 Camp open collection 仍有界，terminal Evidence 继续按需分页，大 Tool 结果不进入普通 DOM 全文；
- Core/Renderer 测试必须使用超过旧 80/600 边界的数据，证明首项仍存在且 coverage 诚实。

### 被拒绝方案

- 仅提高 80/600 的数值：仍会在更长 Run 上静默丢失，只是推迟问题；
- 保持 Camp open 有界、仅给 selected Run 增加后台分页：可以控制首屏，但进入时会先展示不完整过程，并引入
  running high-water、分页追赶和 live suffix 合并的第二套状态机；
- 只依赖 live event、不扩大 Core 投影：中途进入、刷新和 Core/Renderer 重连无法恢复早期过程；
- 把大 Tool payload 全文一并加载：完整 chronology 不要求扩大内容安全边界，会制造无必要 DOM 与 IPC 成本。

### 当前权威影响

- [Camp Open Projection v5](../../contracts/camp-open-projection-v5.md)
- [Camp Open Read Path](../../architecture/camp-open-read-path.md)
- [Camp 会话工作区](../../ui/components/conversation-workspace.md)
- [Run Process Detail Surface v12](../../contracts/run-process-detail-surface-v12.md)
