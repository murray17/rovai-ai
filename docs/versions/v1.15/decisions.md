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
按需全文读取在本决策时保持原边界；后续 [V1.15-D02](#v1-15-d02) 局部替代了用户
显式展开 Tool 后的 DOM 展示取舍，但不改变 Camp open 和 Managed Blob 按需读取边界。

### 后果

- 运行中过程在首次进入、刷新和持续 streaming 时都能从最早 Evidence 开始检查；
- Camp open 响应和 Renderer live state 随 non-terminal Run 活动量增长，不再承诺固定 Evidence 条目预算；
- 其他 Camp open collection 仍有界，terminal Evidence 继续按需分页；大 Tool 结果的当前显式
  展开规则由 [V1.15-D02](#v1-15-d02) 拥有；
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
- [Run Process Detail Surface v13](../../contracts/run-process-detail-surface-v13.md)

<a id="v1-15-d02"></a>

## V1.15-D02：显式展开后优先完整 Tool 结果而非有界预览复制

### 背景

Run Process Detail Surface v8 为避免大 payload 进入 Drawer DOM，只渲染 10 行/2,000 scalar 预览，
再通过 Icon-only 复制按钮按需读取 Managed Blob。这保持了有界 DOM，但用户无法在执行过程
中连续阅读、搜索或键盘检查完整 Step 结果；底部与 Inspector 移动时条件渲染还会卸载
Drawer，使已展开状态和阅读位置丢失。

### 决定

保持 Camp open 有界 Evidence 和 Managed Blob 按需读取；只在用户展开精确 Canonical Tool 行后，
读取并在原位渲染完整公开 `result/error/output/input/patch`。结果不再截断、不提供复制按钮，
而在固定最大高度的可聚焦 region 中内部滚动。读取失败在原 disclosure 显示精确错误和重试。

执行台使用稳定 portal container 在底部和 Inspector host 间移动同一 DOM，并按可滚动范围比例
保留 Drawer 与结果阅读位置。Tool 行同时收口为四个固定轨道、九类 16px 线性 SVG；
队员入口只保留头像、最多两行名称和带形状的状态标记。

### 后果

- 用户明确展开后可在一个表面阅读完整结果，键盘、200% zoom 和紧凑 Inspector 共用同一行为；
- 显式展开的大结果会占用当前 Drawer 会话的 Renderer DOM/内存；切换 Agent、关闭 Drawer 或卸载
  workspace 后释放，不持久化；
- Envelope、request/receipt、canonical input 与无法关联 Tool identity 的 Evidence 仍不可展示；
- 自动验收必须用 8,000 行以上的 Blob 验证延迟读取、首/中/末内容、内部滚动、键盘、
  DOM identity 与位置保持。

### 被拒绝方案

- 继续“有界预览 + 复制全文”：不能满足原位完整阅读的明确产品目标；
- Camp open 直接携带所有大 payload：会把用户未展开的结果也常驻 IPC/DOM，无必要地扩大成本；
- 移动时只记录 selection 后重建 Drawer：无法可靠保留已读全文、disclosure、加载/错误和嵌套滚动位置；
- 仅依赖颜色精简队员状态：Forced Colors 和非颜色识别不足，因此保留形状语法与辅助名称。

### 当前权威影响

- [Run Process Detail Surface v13](../../contracts/run-process-detail-surface-v13.md)
- [Camp 会话工作区](../../ui/components/conversation-workspace.md)
- [Product/Renderer 基础不变量](../../architecture/foundational-invariants.md#product-execution-surface)
