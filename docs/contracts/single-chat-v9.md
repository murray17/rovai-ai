---
document_type: protocol-contract
contract: single-chat-v9
status: accepted
version: 9
source_version: v1.72
last_updated: 2026-10-18
---

# Single Chat v9

继承 [v8](single-chat-v8.md) 未被后续命名、Task 能力与本合同替代的规则。新单聊采用
[ContextManifest v42](context-manifest-evidence-v42.md) 和 [Run Facts v10](run-facts-v10.md)。
模型不再接收 `RUN_FACTS.singleChat`，也不恢复旧 `conversationMode` 名称或添加其他模式标记。

专用 Charter 和四句 `SINGLE_CHAT_GUIDANCE` 保持原字节；无 Memory 的 Bootstrap、
`CURRENT_INPUT`、自动公屏增量、引用、附件及 Skill 选择保持。实际 `single_chat_v1` policy version 2
继续只允许五项只读 Rovai 操作，终态仍由冻结目标与 epoch 校验后写入私有 Conversation。
文件/Git/外部系统修改仍服从专用 Charter 的明确请求要求。

历史模型字段保留在旧冻结输入中，不迁移正文，不改变会话恢复、取消、结束或迟到输出隔离。

有效原生成功结果可以没有最终文字：Run 正常成功并推进 Pending FIFO，但不写空的
`conversation_message`，`finalConversationMessageId` 与 `finalOutputDigest` 为空。已有消息和产物保留；
归属、epoch、取消与结束后的迟到 fence 不变。结果准入见
[Runtime Launch v74](runtime-launch-and-verification-v74.md#claude-结果与局部问卷拒绝)。
