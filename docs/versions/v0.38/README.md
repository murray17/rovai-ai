---
document_type: version-overview
version: v0.38
lifecycle: historical
authority: version-scope-and-status
design_status: frozen
implementation_status: complete
last_updated: 2026-08-05
---

# Rovai-ai v0.38 唯一实时 Task 卡

> 状态：设计与生产实施已完成
>
> 前置版本：[v0.37 MCP Configuration, Projection and Runtime-Group Skills](../v0.37/README.md)
>
> 实施设计：[architecture.md](architecture.md)
>
> UI 合同：[production-design.md](production-design.md)
>
> 实施门禁：[implementation-plan.md](implementation-plan.md)

## 版本意图

v0.38 降低 Camp 会话中的 Task 状态噪声。Task 创建后立即在创建时间位置显示唯一卡片；
后续标题、负责人和状态变化只更新该卡，不再为每次状态转换追加系统 CampMessage。

Task 详情和当前权威状态继续来自 Task Read Side，完整命令结果与变更顺序继续保留在审计
事件中。历史数据库中的旧 `task_event` CampMessage 不删除，但 Renderer 不再把它们重复
展示为会话卡片。

## 范围

- 创建 Task 后立即投影一张会话卡片；
- 卡片固定在创建时间位置，读取当前标题、负责人和四态；
- 标题、描述、负责人和状态的 Tool/IPC 更新合同保持不变；
- 描述只在任务详情展示，卡片不显示百分比或关联 Run 状态；
- Core 的新 Task 更新只写 Task 与 `task.updated` 审计，不创建 CampMessage；
- 历史 Task 收敛为一张当前卡片，旧消息保留但从会话投影中过滤；
- 点击卡片打开 Inspector 中的当前 Task。

## 明确不在范围

- 新增 `blocked`、`failed` 或数值进度等 Task 字段；
- 改变 AgentRun、CampTurn、停止事件、Agent 正文或真实完成总结；
- 删除或改写历史 CampMessage、Task、命令结果或审计事件；
- 收窄 `team.update_task` 的标题和描述更新能力。

## 完成定义

Core 测试必须证明创建、分配和全部状态变化不增加 CampMessage，同时 `task.created` /
`task.updated` 审计保持完整。Renderer 测试必须证明新旧 Task 均只有一张卡、创建锚点稳定、
当前标题/负责人/状态可原地刷新，且旧 `task_event` 不再显示。Typecheck、Renderer 测试、
Core 测试、Clippy 与桌面构建全部通过后方可标记完成。
