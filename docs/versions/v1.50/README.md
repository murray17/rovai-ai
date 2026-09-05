---
document_type: version-overview
version: v1.50
lifecycle: current
authority: version-scope-and-status
design_status: confirmed
implementation_status: complete
model_context_change: true
last_updated: 2026-09-06
---

# Rovai-ai v1.50：Camp 内私有 Single Chat

前置：[v1.49](../v1.49/README.md)。本版本在现有 Conversation、CampTurn、AgentRun、Context、Runtime Fleet 与
Source Attachment 基础设施上增加本地用户与单个 Camp Member 的私有会话；不建立第二套执行系统，也不把私聊正文
或最终回答投影到 Camp 公屏。

## 范围与当前状态

- `conversation.kind=single_chat` 拥有独立 transcript、Native Binding、Native Session 与 accepted public
  watermark；用户显式结束后，同一队员的新单聊使用全新 Conversation 身份且不等待旧 Run cleanup。
- 每条已准入输入仍创建 `CampTurn(kind=single_chat)` 与 `AgentRun(invocation_kind=single_chat)`；Run 冻结私有
  `conversation_message` route 和 `single_chat_v1` Built-in allowlist，terminal final 只写回目标 Conversation。
- Bootstrap 不投递 Memory；Dynamic Context 使用专用 Charter/Guidance，修复 Single Chat 被误判为 A2A lineage，
  并按 official bundled source identity 排除 `cli-operations` 与 `memory-stewardship`。
- Single Chat 与 Camp 公屏共用 `LocalAttachmentSourceRef`、观察/重检、Run-local 解析、预览、打开、Reveal 与
  `AttachmentCard`；唯一领域差异是已发送 Source Ref 归属 `conversation_message` 而非 `camp_message`。
- 未发送附件保存在独立 revision 的 `single_chat_composer_draft`；不复制或冻结用户文件，不创建 Single Chat
  专用附件根、内容 retention、projection 或 receipt。
- 回复进行中仍可发送后续输入。后续输入进入 Conversation-local FIFO，连同 Source Refs 保留；发布前重新验证附件，
  失效队首进入 `needs_repair` 并阻塞同一 Conversation 的后续项，用户可编辑、增删、重排或删除后恢复。
- Renderer 使用带头像的对象选择器、无头像双轨 transcript、执行台式过程与终态自动折叠；Composer 与 Camp
  输入面的附件卡片、键盘语义和操作层级一致，运行中空 Draft 显示“停止”，有正文或附件时仍可“发送”进入队列。
- Single Chat panel 打开时只读取一次列表和当前完整 Snapshot；空闲时不轮询，运行期每约 800ms 只读取当前
  Conversation，并在 terminal 且无自动发布 Pending 后立即停止；列表刷新不接管目标/loading，当前 Snapshot 读取串行且合并一次补读。
- `singleChat.end` 只固定 Camp 与 Conversation ID，不校验 expected version；Core 在同一事务内结束当前实际状态，已 ended 的同一 ID 成功 no-op。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v1.49 冻结为 historical；本概览、[实施计划](implementation-plan.md)、版本索引与前后链接建立唯一 current v1.50 |
| Decisions | 已更新 | [V1.50-D01](decisions.md#v1-50-d01)至[V1.50-D04](decisions.md#v1-50-d04)记录私有执行复用、结束语义、共享 Source Ref 与 Conversation-local FIFO；CURRENT 已纳入导航 |
| Contracts | 已更新 | [Single Chat v2](../../contracts/single-chat-v2.md)在 v1 基础上收敛 exact-ID 结束和 Renderer 刷新合同；Contracts 索引已切换 current 入口 |
| Architecture | 已更新 | [Single Chat Architecture](../../architecture/single-chat.md)及 Architecture 索引同步组件职责、公共附件复用和队列调度流 |
| UI | 已更新 | [Camp 内单聊](../../ui/components/conversation-workspace.md#camp-内单聊)同步共享 AttachmentCard、运行中排队和 repair 编辑交互 |
| Runtime Activity | 确认无需更新 | Single Chat 继续复用既有 Execution Evidence 与 Canonical Activity 映射，没有新增 Runtime activity kind |
| Runtime compatibility | 确认无需更新 | Runtime 目录、能力、版本与平台资格不变；各 Adapter 接收同一公共 resolved attachment paths |
| Documentation routing | 已更新 | 文档任务导航、版本指针、Contracts/Architecture 索引和当前决定导航均指向当前 Single Chat 边界 |
| Root README | 确认无需更新 | 项目定位、安装方式、平台与 Runtime 支持矩阵不因 Camp 内新增私有会话而改变 |

## References

- [实施与验收](implementation-plan.md)
- [版本决定](decisions.md)
- [核心模型上下文变更确认](model-context-change-single-chat.md)
- [Single Chat v2](../../contracts/single-chat-v2.md)
- [Single Chat Architecture](../../architecture/single-chat.md)
- [Camp Attachment v8](../../contracts/camp-attachment-v8.md)
- [Pending Camp Input v3](../../contracts/pending-camp-input-v3.md)
- [Camp 内单聊 UI](../../ui/components/conversation-workspace.md#camp-内单聊)
