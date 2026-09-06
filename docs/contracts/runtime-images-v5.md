---
document_type: contract
contract: runtime-images
version: v5
status: accepted
source_version: v1.53
last_updated: 2026-09-06
---

# Runtime Images v5

v5 inherits [v4](runtime-images-v4.md) 的结构化图片提取、混合存储、限额、Run/epoch fence、
Camp-scoped 读取、同摘要显式附件优先、消息合并、独立兜底和 Gallery 规则。本版只替代 Runtime
图片进入公屏展示投影的来源准入：图片观察与底层记录可以继续存在，但只有 Adapter 已确认的原生生图
结果会出现在 `agentRunImages`。

## 自动展示来源

自动展示采用闭合集，且每个候选仍须通过既有非空、大小、当前 Run/epoch 和可保存结果校验：

1. **Codex 原生生图**：当前 Codex route 的 `item/completed`，且
   `params.item.type == "imageGeneration"`；读取该 item 的原生图片结果。Adapter 写入
   `codex_native_image_generation` 来源。
2. **Antigravity 已完成生图**：当前已验证 conversation 的精确 step，且
   `step.type == "CORTEX_STEP_TYPE_GENERATE_IMAGE"`、
   `step.status == "CORTEX_STEP_STATUS_DONE"`；只读取该 step 的
   `generateImage.generatedMedia`。既有 conversation/step、Run/epoch 和 terminal 去重校验全部保留，
   Adapter 写入 `antigravity_native_generate_image` 来源。

来源值由对应 Adapter 在验证原生事件时赋予。工具展示名、文件名、目录、扩展名、MIME 或图片格式都不能
产生或提升来源；即使工具名为 `generate_image` 也不构成准入。当前不识别第三方生图工具。

Codex MCP image、Claude `tool_result` image、ACP `content:image`、TRAE Read、Copilot
view-image，以及截图、读图或其他工具图片仍可按 v4 的结构化规则被提取和保存，但来源为空，不进入自动
展示。该规则不改变 Runtime 接收工具结果、截图或读图的能力。

## 持久来源与历史数据

Migration 141 从精确 Data Contract `v1.50 / schema 91` 为 `agent_run_image` 增加 nullable
`public_display_source`，并封闭为 `v1.53 / schema 92`。非空值只允许上述两个 Adapter 来源。
旧行不回填、不按工具名或路径重新分类，迁移后保持 `NULL`；无法可靠证明来源的历史图片因此默认不展示，
但图片行、ManagedBlob、稳定原文件引用、重放键和 GC root 均保留。

内部 `RuntimeImageObservation.publicDisplaySource` 使用同一闭合集；字段缺失按未确认处理。来源只用于
公屏投影，不加入 Renderer metadata、消息、附件、Execution Evidence、模型 Context 或渠道 Outbox。

## 统一展示投影

Core 的 Camp 图片 metadata 查询是唯一自动展示门：它先要求 `public_display_source` 属于闭合集，再执行
既有同摘要显式附件过滤并按 Run/epoch 分组。Snapshot、Open、实时刷新、重新打开会话和 Renderer 的
消息合并/终态独立兜底都消费同一结果，因此未获准图片既不能附加到 Agent 公开消息图片区，也不能成为
独立兜底节点。公开 wire shape、Open/Snapshot schema version 和按需读取方法均不变。

过滤不删除图片记录。已有 opaque image id 的 Camp-scoped bytes 读取继续执行既有授权与有界读取，但未
进入 metadata 投影的 id 不会由公屏发现。隐藏图片写入产生的刷新通知可以保留；刷新后的展示集合仍为空。

显式 `rovai send --file` 图片继续走 CampMessage + Managed Attachment 发布链，保持消息附件投影、顺序、
操作和渠道行为；它不读取 `public_display_source`，也不受本合同的自动展示门影响。若已准入 Runtime Blob
与同 Run 显式图片附件摘要相同，仍只省略 Runtime supplement，底层两份记录都保留。

## References

- [Runtime 图片架构](../architecture/runtime-images.md)
- [Camp Open Projection v16](camp-open-projection-v16.md)
- [Camp 会话工作区](../ui/components/conversation-workspace.md#runtime-图片与消息图片)
- [Camp Attachment v8](camp-attachment-v8.md)
