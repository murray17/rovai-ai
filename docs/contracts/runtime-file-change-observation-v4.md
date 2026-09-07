---
document_type: contract
contract: runtime-file-change-observation
version: v4
status: accepted
source_version: v1.55
last_updated: 2026-09-07
---

# Runtime File Change Observation v4

v4 完整继承 [v3](runtime-file-change-observation-v3.md) 的 typed read/write、文件变化三层模型、managed output
排除、AgentRun 汇总与读取授权。本版只增加 Pi `edit` 的终态原生 patch 准入，并以 `activity-v4` 隔离新映射；
Pi `write` 仍只有路径级操作事实。

## Pi edit patch 准入

Pi JSONL RPC v1 只有同时满足以下条件时才产生 Diff Evidence：

- 事件是成功的 `tool_execution_end`，`toolName` 精确为小写 `edit`；
- 同一 `toolCallId` 已观察到非空 `args.path`；终态省略参数时只允许复用该 ToolCall 的 start/update 参数；
- `result.details.patch` 是非空字符串，且同时包含精确的 `--- {reported path}`、`+++ {reported path}` 文件头和至少一个
  `@@ ` hunk；
- 文件头路径必须与结构化 `args.path` 完全一致。CR、LF、NUL、路径冲突、缺失 hunk 或零变化全部 fail closed；
- 路径继续按 execution root 纯词法规范化并执行精确 managed output 排除；规范化后的统一 Diff 文件头使用展示路径。

准入后继续使用 schema 1 `runtimeDiff`，`semanticKind` 归一为 `unified_diff_snapshot`，来源 metadata 保留
`adapterKind=pi`、`protocolFamily=pi-jsonl-rpc-v1` 和
`sourceEventKind=tool_execution_end.completed`。增删统计只计算 hunk 内真正以 `+`／`-` 开头的内容行，文件头不计数；
内容本身以 `++`／`--` 开头时仍是有效变化行。

Pi `write` 没有等价的原生 before/after 或 patch，继续只发布 typed write operation；产品不得从 input 内容、当前磁盘、
Tool 输出或后续文件状态反推 `+ / -`。`result.details.diff`、Edit 输入里的替换文本以及其他 Tool/Extension 的同名字段均不
属于本合同来源。字段缺失或不合格不会影响原有 path-only 文件行。

## Canonical 与读取兼容

Migration 147 在 Notification Single Chat Migration 146 已登记后，从精确来源
`v1.54 / projection schema 96 / activity-v3` 原子推进到
`v1.55 / projection schema 97 / activity-v4` 并登记 receipt。迁移不重写 Evidence、Canonical Activity 或 AgentRun
文件投影；失败回滚 marker 与 receipt。未知、未来或部分 schema 继续 fail closed。

operation 首次建立的 classifier 保持冻结：v1、v2、v3 in-flight activity 按原版本结算，切换后新 activity 使用 v4。
Read Side 按 v4、v3、v2、v1 的确定性优先级读取。只有 activity-v4 将新准入的 Pi Diff 绑定到 Canonical
`file / file.write`；既有 v3 activity 不被重新分类。AgentRun projector 仍消费新写入的不可变 terminal Evidence，
并沿用 v3 的单文件 operation identity、增删统计和敏感 detail 授权。

## 验收

- Pi 成功 `edit` 的 path-bound 原生 patch 形成规范化 unified Diff、inline disclosure 与可靠 `+A / -D`；
- `write`、失败 edit、缺 patch、路径冲突、缺 hunk、非法路径和零变化都不伪造 Diff；
- 终态省略参数时只复用同一 `toolCallId` 的已观察参数，不跨 ToolCall 拼接；
- managed output、root 内外路径和 Diff 大小限制继续沿用 v3，其他 Runtime 映射不变；
- migration 147 原子切换 classifier marker，v1/v2/v3 历史和 in-flight activity 不回写、不重投影。

## References

- [Runtime File Change Observation v3](runtime-file-change-observation-v3.md)
- [Runtime File Change Observation 架构](../architecture/runtime-file-change-observation.md)
- [Runtime Activity Registry](../runtime-activity/registry.md)
- [v1.55 实施与验收](../versions/v1.55/implementation-plan.md)
