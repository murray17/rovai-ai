---
document_type: protocol-contract
contract: feishu-channel-v8
authority: feishu-channel-project-binding-admission-delivery
status: accepted
version: 8
last_updated: 2026-08-31
---

# Feishu Channel v8 Contract

继承 [Feishu Channel v7](feishu-channel-v7.md) 的身份、发布、入站、执行卡、永久正文与 Outbox 合同。
本版仅允许 Owner 在未绑定的飞书普通群或独立话题中，选择既有项目或显式开始 Quick Chat。
既有绑定不可换绑；私聊、`/new`、普通群内 thread 拒绝、钉钉操作入口和模型协议不变。

## 1. 项目选择卡

保留“选择 Rovai 项目”标题。第一段为“选择一个项目，或直接开始快速对话。”；第二段为
“选择项目后，这个话题之后都会使用该项目；快速对话不绑定项目。”。普通群将“话题”替换为“群聊”。
有项目时一整行原生 `select_static`，下方一行两个原生按钮：“开始快速对话”“刷新项目”。
空目录不发送无选项下拉框，保留快速对话与刷新，并说明可先在 Rovai 创建或打开项目。
项目选项仍仅包含 opaque ID 与 bounded display name，不展示或发送本机路径。

Quick Chat 按钮的 `rovaiAction=start_quick_chat` 映射到既有
`channels.feishu.pendingBinding.resolve` 的 `action=quick_chat, projectId=null`。
携带项目 ID 的 Quick Chat 请求拒绝；不使用伪造 Project Catalog ID、不解析回调中的路径。
正常项目、取消和刷新动作保持。飞书 `cardRevision=4`；既有 pending 旧卡通过当前 revision
reconciliation 原位更新并轮换 nonce/version，不重复创建 pending 或 Camp。钉钉保持 revision 3。

## 2. 统一绑定事务

项目与 Quick Chat 共用 frozen acknowledgement App、真实 operator、权威消息 ID、nonce、version、expiry、
Owner 和 roster 校验。Quick Chat 仅接受飞书 `group/topic` pending，不能扩展到其他 Provider 或私聊。
Main 在提交前同样重读 roster。Core 独立验证，不以按钮可见性证明权限。

Quick Chat 的路径由 Core 从本地 data-dir 的受管 `quick-chat` 目录提供并规范化；外部 callback 不提供路径。
同一事务创建 `execution_scope_kind=quick_chat, project_id=NULL` binding，建立普通 Quick Chat Camp，
使用当前群 Bot roster 为协作队员，以首条有效消息自动命名，并按原 FIFO 通过统一 admission。
Camp、message/Turn/Run、pending resolved 与 recall delivery 要么一起提交，要么全部回滚。
后续消息使用同一个 Camp/工作区；重复点击、过期卡或点击另一选项不能创建第二个 Camp 或换绑。

成功结果仍为 `channel.binding.resolved`，增加 `executionScopeKind=project|quick_chat`。
Quick Chat 的 `projectId/projectDisplayName` 为 null，Host 提示“已开始快速对话，正在处理消息”；
项目模式仍提示“项目已绑定，正在处理消息”。随后沿用异步撤回，不保留永久完成卡。

## 3. 持久兼容

Migration 132 从精确 `v1.41 / projection schema 82` 升至 `v1.42 / projection schema 83`。
仅重建 `pending_camp_binding` 的 resolved CHECK，允许已绑定 Quick Chat 的 `project_id=NULL`；
resolved 仍必须有 binding、Camp、完成时间，其余 pending/cancelled/expired 约束不变。
`channel_conversation_binding` 原有 project/quick_chat 与 nullable project ID 的互斥 CHECK 保持。

使用现有逐版本 IMMEDIATE 事务与同事务 receipt。保留原有行、字段、ID、索引和所有入向 FK 引用，
提交前只检查受影响表及其入向引用。失败回滚当前步骤并恢复外键 enforcement，重开不重复迁移。
不批量改名、改派项目、清空队列、修改凭据或触碰历史消息；旧版本不得以旧 marker 打开新 schema。

## References

- [飞书渠道架构](../architecture/feishu-channel.md)
- [渠道 UI](../ui/components/channel-settings.md)
- [渠道 Camp 命名](channel-camp-naming-v1.md)
- [v1.36 实施计划](../versions/v1.36/implementation-plan.md)
