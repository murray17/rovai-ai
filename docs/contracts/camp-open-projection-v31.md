---
document_type: protocol-contract
contract: camp-open-projection-v31
authority: camp-open-read-model
status: accepted
version: 31
source_version: v1.72
last_updated: 2026-11-05
---

# Camp Open Projection v31

继承 [v30](camp-open-projection-v30.md) 未被下述条款替代的规则。Thread snapshot schema 36、
threads.open schema 9 及字段形状保持。

## 公开执行列表的会话归属

`threads.enter/open` 与完整 Thread snapshot 的 `agentRuns`、Open 的 Run coverage，以及公开
`agentRunFileChanges` 列表，只按 `agent_run.camp_id = threadId` 选择运行；公开 Run 列表继续排除
`single_chat`。不得通过历史 CampTurn 推导缺失的 Run 会话归属。

`camp_id` 为 null、只由旧 CampTurn 关联的公开 Run 不再进入上述执行列表、运行数量或文件变更卡片。
读取不迁移、回填或删除这些 Run、状态、Evidence 或文件变更记录；历史消息正文保持原读取路径。
单聊当前使用的 Turn 归属与按具体 Run 身份读取的详情、诊断不属于本次退役范围。
Renderer 只为仍有关联 Run 或 Delivery 事实的接收者显示处理回执；缺少事实不能推导为“待处理”。

## 查询边界

Run 计数和列表通过已有会话索引选择本 Thread 的 Run；文件变更列表先选择本 Thread 的 Run，再按
Run 身份关联投影与 epoch 状态。查询不得随其他 Thread 的 Run 或文件变更投影数量逐行增长。
不新增数据库 schema、Migration、持久副本或后台历史修复。

当前与历史范围的取舍见 [V1.72-D75](../versions/v1.72/decisions.md#v1-72-d75)。
