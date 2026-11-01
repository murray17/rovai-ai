---
document_type: protocol-contract
contract: agent-run-continuation-v4
status: accepted
version: 4
source_version: v1.72
last_updated: 2026-10-29
---

# AgentRun Continuation v4

继承 [agent-run-continuation-v3](agent-run-continuation-v3.md) 未被下述条款替代的规则。

取消 Task ID/状态/分配对新继续及 waiting 继续执行的准入。Task 关闭、完成、取消或改派不取消已排队的继续，也不改变接收者。原 Task 审计关系保留；成员、Conversation、原 Run、Session、取消和执行 fencing 仍按 v3 判断。

清理准入统一采用[当前执行所有权判断](../architecture/agent-run-recovery.md#4-cleanuplane-与-execution-root)：
当前 Core 持有的 Run/epoch 清理未确认时等待；历史缺 ACK、不可读或身份未知不能持续阻挡新继续。
放行不补写旧 ACK，也不把新的用户授权等同于重放原 Runtime 投递。
