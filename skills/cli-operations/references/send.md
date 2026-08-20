# Send：一次公开协作事件

使用 `rovai send --help` 获取当前闭合输入、约束和短例子。

一个 Send 可以产生三个彼此正交的效果：

- **Public message**：在当前 authenticated AgentRun 的 Camp 中留下所有参与者可见的 CampMessage。
- **Agent routing**：向一个或多个 Agent 建立冻结 Delivery；只有 Agent recipient 参与 routing。
- **User attention**：把普通公开消息升级为需要当前用户特别处理的 attention；它不创建 Agent recipient 或 Delivery。

只需要公开记录时，发送 public-only message。需要某位 Agent 继续处理时增加 Agent routing。只有本条消息
产生新的、未解决的用户决定、回答或行动时，才增加 User attention。User attention 不是给用户创建 Task，
也不是把用户算入 Agent recipient cardinality。

## User attention

普通 CampMessage 已经对用户可见。

`--to-user` 是 attention escalation，不是普通 visibility，也不是另一种 recipient。只有当前消息新产生了
一个尚未解决的用户决定、回答或行动，或者用户明确要求重要异步结果通知时才使用。

不要在以下情况使用：

- 内部 Agent routing；
- 评审和交接；
- 常规进度；
- acknowledgement；
- 普通最终回复；
- 因为上一条消息提及了用户；
- 因为当前消息使用了 `--to`。

User attention 只属于当前消息，不会被 reply、Task、父子 AgentRun 或下游 A2A 继承。

默认由承担用户侧闭环责任的 Agent 决定是否提醒用户。内部评审或子任务 Agent 应把结果返回调用方，而
不是沿协作链继续提醒用户。该责任分工是 Agent 使用指导，不是 Core authorization 或角色拒绝规则。

`--to` 与 `--to-user` 只有在用户和 Agent 各自拥有相互独立的行动时才组合。如果 Agent 工作依赖用户
决定，先请求用户输入，收到回复后再唤醒 Agent。

不要为普通答复、状态同步、澄清问题、一次性请求或“请看这条消息”创建 Task。只有同一责任需要跨
AgentRun 保留、独立交接和验收时，才按 [Task](task.md) 的边界升级。

把消息关联到 Task 时，必须恰好有一个 Effective Agent Recipient；是否提醒当前用户不改变这个条件。
Send 成功只证明消息和冻结效果已提交，不证明 recipient 已启动或完成工作。

## 附件

使用 `rovai send --file <path>` 将本地文件随当前 CampMessage 发布为不可变 Camp 附件。

可以重复使用 `--file`。附件按照参数出现顺序排列，并显示在消息正文之后。发送文件不需要提前执行单独
的上传操作。

命令成功后，不要重复发送同一交付。
