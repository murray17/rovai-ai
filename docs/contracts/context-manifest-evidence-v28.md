---
document_type: protocol-contract
contract: context-manifest-evidence-v28
authority: public-multi-input-agent-run-context-evidence
status: accepted
version: 28
last_updated: 2026-09-23
---

# ContextManifest Evidence v28

公开 Camp 新输入使用 Formatter/Manifest 28、Profile 8、内部 Run Facts 6；普通 Camp、A2A 与
Single Chat 新输入使用 Formatter/Manifest 26、Profile 6、内部 Run Facts 5。新 Bootstrap 使用
合同 v4/Formatter 4，Session Charter revision 12 不变。Section 顺序、选择、预算、引用闭合和
读写权威继承 [v27](context-manifest-evidence-v27.md) 与 [v25](context-manifest-evidence-v25.md)
的当前业务语义；[revision 3](../versions/v1.67/model-context-change-task-versionless.md) 提供完整前后
结构和省略规则。

模型正文中的 `MEMBER_IDENTITY` 保留六个身份业务字段，空字符串/数组仍输出；
`COLLABORATION_STATE` 保留 `peers, defaultLeadAgentId, selfIsDefaultLead`；`RUN_FACTS` 保留
业务事实，Single Chat 保留 `conversationMode`；`SINGLE_CHAT_GUIDANCE` 保留原四条指令。
这四处生成投影均不含 `schemaVersion`。模型可见用户原文和引用不做文本替换。

`SELF_ACTIVE_TASKS` 模型正文仍只含 `taskId/title/status`。Manifest 机器证据的
`selectedTaskRefs[]` 为 `{taskId, updatedAt}`，不含 Task version。`projectionDigest` 仍对实际
`SELF_ACTIVE_TASKS` JSON 字节计算；证据、Collaboration 和完整 payload 的 digest 都按新投影
计算。内部 Manifest/Run Facts/Profile 版本保留用于写入与恢复判断，不进入模型正文。

旧 Bootstrap Evidence、ContextManifest、冻结 Runtime payload、命令回执和历史审计原样保存。
旧冻结执行不再派发、转换、双读或自动重播；必要时开始新执行或新 Session。
