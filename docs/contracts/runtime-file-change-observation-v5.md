---
document_type: contract
contract: runtime-file-change-observation
version: v5
status: accepted
source_version: v1.56
last_updated: 2026-09-09
---

# Runtime File Change Observation v5

完整继承 [v4](runtime-file-change-observation-v4.md)，只增加官方 ZCode 原生来源。

## 路径操作与 Diff

来源固定为 `adapterKind=zcode-app`、`protocolFamily=zcode-app-server-v1`、`sourceEventKind=tool.updated.result`。
只在同一原生 ToolCall 的完整 `model.streaming.kind=tool_call` 参数已被观察后接纳 result；Read/Write/Edit 的
`input.file_path` 形成唯一路径。失败、Shell 非零 exitCode 或 timedOut 不能产生成功文件效果。

Edit Diff 额外要求 `result.display.kind=file_diff`、非 truncated、filePath 与同 ToolCall 参数完全相等，以及非空
structuredPatch。每个 hunk 的 old/new 起点、长度与内容行数必须相符且按序不重叠；additions/deletions 必须等于
真实变化行计数。非法路径、非法行、计数冲突、超限或零变化不产生 Diff。

验证后的 patch 转成 path-bound unified diff；不可变 Evidence 使用现有 `unified_diff_snapshot`，继承 execution-root
路径规范化、managed output 排除、大小限制与读取授权。Write 没有等价原生 Diff 时只形成路径操作，不把 content
参数推导成新增/覆盖 Diff；Read 的原生缓存命中也不被描述成已发生磁盘读取。Bash 中的 git diff 属于命令输出，
不自动升级为已应用文件变化。

## 迁移与历史

Migration 148 从 `v1.55/schema 97/activity-v4` 原子升级到 `v1.56/schema 98/activity-v4`，扩展 Runtime、Skill、
Bootstrap Redelivery 与 Compaction 闭集，保留数据、索引、触发器和外键。所有既有 Activity 分类输入与规则不变；
新增 Runtime 使用已存在的 kind=read/write/edit/execute 语义，因此不重分类或回写历史。
