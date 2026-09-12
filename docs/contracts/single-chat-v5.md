---
document_type: contract
name: Single Chat
version: v5
status: accepted
source_version: v1.58
last_updated: 2026-09-12
---

# Single Chat v5

继承 [v4](single-chat-v4.md) 的私有路由、Source Attachment、Context/Built-in policy、目标代次与执行准入。
本版只改变 Desktop 待发送消息的编辑方式，公屏对应 [Pending Camp Input v4](pending-camp-input-v4.md)。

`singleChat.pendingInputs.edit` 新增 `{ type: 'return_to_composer', expectedDraftRevision: number }`。
沿用 local User、active Conversation、Camp scope、Pending revision 校验；存在选中行的旧 edit session 时仍要求
匹配 token。`single_chat.pending_input_changed` 或 `single_chat.draft_changed` 拒绝时两个 owner 均不改变。

同一事务将 canonical Pending source refs 和 quotes 覆盖写入该 Conversation 的 Draft，清空 quote trash 并推进
Draft revision，把原 Pending 标为 cancelled 并推进其 revision，清除该行的旧 edit session。不删除用户原文件。
返回持久结果 `single_chat.pending_input_returned_to_composer`，payload 为 `{ pendingInputId, body, draft }`；
`draft` 为完整无路径 SingleChatComposerDraftView。重复 command 回放同一结果，不再次覆盖 Draft。

正文仍遵循 Single Chat 已有的窗口内草稿生命周期，不增加正文 autosave 或数据库字段。Renderer 只在成功回执后，
把返回正文写入精确 Conversation 的普通输入框草稿，并采用回执的完整 Draft 投影；后台读取不覆盖正文。
移回期间锁定正文、附件、引用、目标切换及发送，迟到结果不能写入其他 Conversation 的输入框。拒绝保留原正文。
运输结果未知时继续锁定，使用“重试移回消息”重放相同 command ID 与原始 payload，恢复持久回执中的正文；
不得创建新 command 或仅凭队列消失认定内容已恢复。移回请求及未知结果恢复参与 Camp 离开保护，
回执应用前不得通过 Camp/页面导航卸载恢复描述；普通成功后的正文草稿生命周期保持不变。

队列移除原行，取消蓝色编辑状态和独立编辑器；旧版未完成 session 使用中性移回/删除提示。用户重新发送时创建
新的普通输入，队列非空或仍有运行则排到队尾，否则直接发送。Scheduler 和发布事务继续以当前队首及 revision
准入；先退回则旧发送失败，先发布则退回失败。输入框编辑不阻塞剩余队列。
