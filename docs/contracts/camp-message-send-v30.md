---
document_type: protocol-contract
contract: camp-message-send-v30
status: accepted
version: 30
source_version: v1.72
last_updated: 2026-11-07
---

# Camp Message Send v30

继承 [v29](camp-message-send-v29.md)。新增项目文件 Atom 的发布流程：已记录 commandId 先回放，
首次发送在短锁读取目标 Thread 绑定，锁外预检普通可读文件，事务中再次复查回执与业务绑定。
Core 构造正式文件段并检查完整投影字节；任一文件失败拒绝整条消息，定位 segmentIndex，保留草稿。
文件 I/O 不进入 SQL 事务，拒绝回执同样先复查并发回执。

普通 Pending 的邀请、激活、消息和 Deliveries 沿既有事务原子提交；Active 独立邀请仍保持独立命令。
有效文件构成本轮输入，可仅文件发送；文件不参与接收者计算。未知结果重放同一命令，不改写旧回执或路径。
字段、数量及预算见 [Project File Reference v1](project-file-reference-v1.md)及
[已确认 R1](../versions/v1.72/model-context-change-project-file-reference.md)。
