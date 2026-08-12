# Task：跨 Run 的独立责任

只有一项责任同时需要持久追踪、跨 AgentRun 生存，并能独立交接或验收时，才创建 Task。短暂协调、
公开答复、进度广播、澄清问题和仅需用户注意的消息仍是 CampMessage。

根据动作读取一个精确 help：

- 创建责任：`rovai task create --help`
- 按稳定 ID 读取：`rovai task get --help`
- 查找任务集合：`rovai task list --help`
- 修改已有责任：`rovai task update --help`

先读取现有 Task，避免为同一责任重复创建。更新时使用刚读取的当前版本，并把版本冲突作为状态已变化
处理，不要用新 Task 绕过冲突。

Task 与公开消息承担不同职责：Task 保存持久责任，CampMessage 向 Camp 公开沟通。需要在消息中关联
Task 时，Send 必须恰好有一个 Effective Agent Recipient；User attention 不计入这个 cardinality。
先让 Task 达到应有状态，再发送需要公开的交接、请求或结果消息。
