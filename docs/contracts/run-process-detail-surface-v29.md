---
document_type: protocol-contract
contract: run-process-detail-surface-v29
authority: runtime-compaction-display-presentation
status: accepted
version: 29
source_version: v1.38
last_updated: 2026-09-03
---

# Run Process Detail Surface v29

完整继承 [v28](run-process-detail-surface-v28.md) 的布局、Evidence、Tool 分组、请求阶段、详情交互和取消终态。
本版只增加执行台专用的 Runtime Compaction 展示旁路，不建立通用 Compaction lifecycle、持久 occurrence、独立表或
跨 AgentRun 关联。

## 本地展示事件

Core 只能在 Rovai 现有入口已经捕获的 Runtime 精确信号旁生成 `runtime.compaction.display` / schema 1。事件只允许绑定
信号捕获当时仍可证明的
`agentRunId + executionEpoch`；没有 exact active lease/route、Runtime 或 Native Session 不一致、Run 已换 epoch、已取消或
已终态时静默跳过展示。
Bootstrap redelivery observation、digest、observer lease、v1 IPC 和 uncertain recovery outbox 保持原协议；outbox replay 不补挂
展示事件。Codex `item/started|completed` 的 `item.type=contextCompaction` 必须在普通 activity 投影前拦截；缺少非空
item ID 时降为不可展示的 native 事件，不能变成 Tool。

Runtime Compact 行只投影 Rovai 当前已有入口能够捕获的原生事件。执行台展示功能不得主动为尚未接入的 Runtime 安装 Hook、
Plugin 或配置 Overlay，也不得修改 Runtime 的启动参数、环境或用户配置。Claude Code 与 Cursor Agent 当前无展示入口；本次
需求不新增其协议接入。

展示载荷只保留 `schemaVersion`、`compactionId`、`adapterKind`、`phase`、可选 `completionEvidence`、Runtime 明确给出的
token/message/elapsed 字段及显式 summary。不得从 token drop、文本关键词、Session ID、时间窗口或其他事件猜缺失字段。
现有 Qoder/Qwen observation Hook 的 `summaryText` 可复用本地 Execution Evidence/Managed Blob 全文路径，但整个事件不进入
公开 execution Evidence、飞书、钉钉、局域网执行台、世界地图或 Canonical Activity。

## 执行台呈现

Compaction 是根级、非 Tool process item，天然切断前后连续 Tool 分组，且永远不增加“已执行/已汇总 N 项操作”的 N。
同一 `compactionId` 的 started/completed 快照在 Renderer 原位更新为一行；这只是当前 Run 的展示合并，不是持久
occurrence folding，也不处理乱序或跨 Run 帧。

行高与普通 command 同为 28px，并复用 `16px 独立图标 / 可缩略标题 / 16px 状态点 / 20px disclosure` 四轨结构、
hover/focus、展开箭头和 command result 文本框；独立图标继承普通 command 的 muted 前景色，不使用 Runtime 或品牌强调色。
`imminent` 显示“即将压缩会话上下文”，但状态为 `recorded` 且不抑制普通“正在处理”；只有非终态 Run 中的 `started`
使用 `running` 并占用压缩中的活动态。`started` 显示“正在压缩会话
上下文”，普通完成显示“压缩会话上下文”；只有 `post_compaction_boundary` 可显示“已进入压缩后的新上下文”。标题追加
真实 Runtime 名称；仅当 before/after 都明确存在时追加 `<before> → <after>` token 摘要。

只有至少一个明确 token 字段或非空 summary 才允许展开。Runtime 名称、native event、Session/事件 ID、trigger、phase、
completion evidence、message count 或 elapsed 单独存在均不能产生 disclosure；该行必须使用不可点击的静态元素并保留空的
末轨占位。展开详情按已有 command result 读取完整 Managed Blob；token、减少量/比例、消息数与耗时只显示明确数据，summary
单独存在时直接显示原文，同时有指标时在同一文本框内以“会话摘要”分隔。不得增加第二张卡片、复制按钮或公共消息。
