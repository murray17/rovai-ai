---
document_type: contract
name: Camp Open Projection
version: v9
status: accepted
source_version: v1.34
last_updated: 2026-08-31
---

# Camp Open Projection v9

v9 replaces [v8](camp-open-projection-v8.md). 有界集合、事务 high-water、历史分页、membership reconciliation、
非终态 Evidence 和文件变化投影不变。`CampMemberView` 增加可选 `fast`，字段与资格见
[Camp Member Fast v1](camp-member-fast-v1.md#用户命令与只读投影)。

缺少资格时省略字段；旧 reader 可忽略该字段，新 reader 允许缺失。因此 Snapshot schema 34 / Open schema 5
保持不变。读取只查询数据库缓存，不启动 native auth/config/model 检查，不发起模型请求。Fast 更新事件
触发当前 Camp 投影刷新；不改变消息分页 cursor、导航 snapshot 或 Activity 映射。

## Public A2A 投递来源

`MessageDeliveryView` 的 `public_a2a` 分支增加可选 `sourceAgentRunId`。当前 Core 在完整 Snapshot 和有界
Camp Open 中都直接投影 `message_delivery.source_agent_run_id`，与公开消息是否仍在当前分页无关。
它表示发出该投递的因果作者 Run，不是 `targetAgentRunId`、`targetParentAgentRunId` 或
`returnToAgentRunId`；forward、return、gather-captured return 和重试均保留这个区别。
`gather_completion` 分支不增加该字段，不把私有综合投递展示为公开收件人。

旧 reader 可以忽略新增字段；新 reader 在旧投影缺失字段时不猜测归属。因此 Snapshot schema 34 / Open
schema 5 保持不变，不新增数据库列、Migration、Event 或模型可见上下文。执行台只展示来源精确匹配当前
Run 的公开投递对象，呈现规则见 [Camp 执行过程](../ui/components/conversation-workspace.md#camp-执行过程)。
