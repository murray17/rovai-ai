# Send：一次公开协作事件

使用 `rovai send --help` 获取当前闭合输入、约束和短例子。

一个 Send 可以产生三个彼此正交的效果：

- **Public message**：在当前 authenticated AgentRun 的 Camp 中留下所有参与者可见的 CampMessage。
- **Agent routing**：向一个或多个 Agent 建立冻结 Delivery；只有 Agent recipient 参与 routing。
- **User attention**：提醒当前用户查看这条消息；它不创建 Agent recipient 或 Delivery。

只需要公开记录时，发送 public-only message。需要某位 Agent 继续处理时增加 Agent routing；需要用户
查看或决定时增加 User attention；两种 addressing 可以同时存在，互不替代。User attention 不是给用户
创建 Task，也不是把用户算入 Agent recipient cardinality。

不要为普通答复、状态同步、澄清问题、一次性请求或“请看这条消息”创建 Task。只有同一责任需要跨
AgentRun 保留、独立交接和验收时，才按 [Task](task.md) 的边界升级。

把消息关联到 Task 时，必须恰好有一个 Effective Agent Recipient；是否提醒当前用户不改变这个条件。
Send 成功只证明消息和冻结效果已提交，不证明 recipient 已启动或完成工作。
