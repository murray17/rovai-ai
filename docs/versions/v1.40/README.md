---
document_type: version-overview
version: v1.40
lifecycle: current
authority: version-scope-and-status
design_status: confirmed
implementation_status: complete
model_context_change: true
last_updated: 2026-09-04
---

# Rovai-ai v1.40：Camp 内单聊与私有回复路由

前置：[v1.39](../v1.39/README.md)。本版本在现有 Conversation、CampTurn、AgentRun、ContextManifest、
RuntimeInputDelivery、Native Binding 与 Cancellation Settlement 上增加一个封闭的 Single Chat 模式，
不建立第二套执行、恢复、队列或 Runtime 能力系统。

## 产品承诺

**单聊正文不会进入 Camp 公屏。** 该承诺只约束 Rovai 自有消息和输出路由；Workspace 文件变化、Shell
副作用、Runtime/Provider 内部执行方式和审计证据不会因此自动私密、回滚或消失。

## 范围与状态

当前判定：

```text
implementation-ready = yes
```

领域、路由、迁移、Context、Renderer 与验证 owner 均已闭合；完整证据见
[实施与验收](implementation-plan.md)。

- `Conversation.kind` 增加 `single_chat`。同一 `(camp_id, agent_id)` 最多一段 active Single Chat；结束后可立即
  创建全新的 Conversation、Binding、Native Session、私有 transcript 与公共水位。
- `singleChat.send` 在一个事务内写用户 `conversation_message`、`CampTurn(kind=single_chat)` 和唯一
  `AgentRun(invocation_kind=single_chat)`，同时冻结私有输出路由和 `single_chat_v1` Built-in 策略。同一段
  Conversation 只允许一个非终态回复，不增加 Camp 全局回复槽。
- Single Chat 附件使用独立的 Conversation-scoped 私有暂存与 immutable message attachment，不进入 Camp Composer
  Draft 或公共附件根；当前消息附件经 receipt 复核后只投影到对应 Run 的 `ROVAI_RUN_TMP` 并进入 `CURRENT_INPUT`。
- Single Chat Bootstrap 只投递专用 Charter 与 Member Identity，不读取或渲染 Memory Entrypoint。Dynamic Context 保持
  固定顺序；新增公共消息只在下一次发送时按私有 watermark 增量投递，并包含目标队员自己的公屏消息；ACK 不推进
  普通成员会话水位。
- `single_chat_v1` 只允许当前 Camp search/read 与 `single_chat.history`。历史操作从当前有效 Run 推导 Conversation，
  只读 `CURRENT_INPUT` 之前的单聊正文；Task/Memory 和其他 Rovai operation 均不可用。既有 Skill/MCP exposure 保持，
  仅按 official bundled source identity 过滤 `cli-operations` 与 `memory-stewardship`。
- Runtime final 成功时只追加一条 agent `conversation_message`，不创建 CampMessage、不运行 Missing-Send
  Recovery、不投递外部 Channel。流式和执行证据按 Conversation、Run 与 execution epoch 精确归属。
- App/Core/Runtime Host 重启时，非终态 Single Chat Run 沿用既有取消结算并按普通取消呈现，不展示重启原因；
  Conversation 保持 active，下一条输入创建新 Run，不新增恢复状态或旧输入重放。
- 用户“结束”是 `active → ended` 的业务线性化点；旧 Run 进入取消/清理，私有输出路由立即关闭。用户可立即
  开始同一队员的新单聊，不等待旧 cleanup；旧迟到事件只能成为旧 Run 证据。
- Renderer 在 Camp Header 提供单聊入口与带头像的对象选择器。用户消息居右、队员回复居左且没有消息底色框，正文不显示头像；
  执行过程复用执行台语义并把连续 Command 聚合为“已执行 x 项操作”，终态自动折叠过程，在分隔线下保持 final
  message 展开。Composer 与群聊保持同一输入风格，提供私有附件、发送/换行提示与发送按钮；结束确认使用
  “这段对话将被删除且无法回复。”、“取消 / 结束”和“不再询问”。

正式字段、错误、并发、恢复和投递边界见 [Single Chat v1](../../contracts/single-chat-v1.md)，组件关系见
[Single Chat Architecture](../../architecture/single-chat.md)，Renderer 规范见
[Camp 会话工作区](../../ui/components/conversation-workspace.md#camp-内单聊)，已确认模型输入差异见
[Single Chat Context 变更](model-context-change-single-chat.md)。

## 明确不做

- 不新增 SingleChatTurn、SingleChatRun、SingleChatContext、专用 Scheduler、等待队列或跨 Conversation cleanup fence。
- 不新增通用 Capability DSL、Adapter delegation gate、Runtime 原生工具/子 Agent 检测或控制。
- 不新增私有 transcript replay、摘要迁移、`recovery_blocked`、Native Turn reconcile 或专用重启提示。
- 不把“正文不进公屏”扩大为工具副作用、文件变化或外部 Runtime 状态均不可见。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v1.39 冻结为 historical；本概览、决定、实施计划与版本索引建立唯一 current v1.40 |
| Decisions | 已更新 | [V1.40-D01](decisions.md#v1-40-d01)固定复用现有执行体系与封闭私有路由；[V1.40-D02](decisions.md#v1-40-d02)固定取消、结束和 successor 并发语义 |
| Contracts | 已更新 | [Single Chat v1](../../contracts/single-chat-v1.md)拥有领域、命令、策略、上下文、终态路由和迟到事件合同；[Built-in Tool Transport v22](../../contracts/builtin-tool-transport-v22.md)拥有新增 history operation 与 CLI transport |
| Architecture | 已更新 | [Single Chat Architecture](../../architecture/single-chat.md)拥有 Core、Runtime、Context 与 Renderer 数据流；[AgentRun Recovery](../../architecture/agent-run-recovery.md)排除 Single Chat 的专用恢复推断 |
| UI | 已更新 | [Camp 会话工作区](../../ui/components/conversation-workspace.md#camp-内单聊)拥有对象选择、左右消息、执行折叠、停止和结束确认 |
| Runtime Activity | 确认无需更新 | Single Chat 复用现有 AgentRun Execution Evidence 和分组语义，不增加 Canonical Activity 类型或映射 |
| Runtime compatibility | 确认无需更新 | v22 只扩展 Core/CLI catalog；不改变 Runtime 准入、Provider delegation、模型或外部工具兼容性承诺 |
| Documentation routing | 已更新 | 文档导航、Architecture/Contract/UI 索引和当前决定导航均增加 Single Chat 当前入口 |
| Root README | 确认无需更新 | 项目定位、安装方式和稳定公开能力清单不因当前版本局部功能改变 |
