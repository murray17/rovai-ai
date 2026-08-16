# Gather：并行征集后统一续跑

使用 `rovai gather --help` 获取当前闭合输入、限制和例子。

只有当前 Default Lead 要把同一个公开主题发给一个或多个成员，并且必须等所有成员 Run 终态后再统一
综合时，才使用 Gather。当前版本对所有成员使用同一 `body`；`to` 应使用 canonical Agent ID，重复目标由 Core
冻结去重。

Gather 接受成功只表示公共消息、成员 Delivery、Barrier 和稍后的 completion 责任已持久化。接受后结束
当前 Lead Run；不要轮询、同步等待、重复 Gather，或用普通 Send 再次唤醒 Lead。成员仍通过
`rovai send` 或公开 `@Lead` 正常回复，消息保持公开可见；与该 Gather 精确绑定的回传会被持久捕获，
不会立即物化 Lead Run。

显式回传只是结果证据，不代表成员工作已经结束。成员可以发送进度，但同一 Item 当前 Run/retry generation
只有最后一条成功接受的回传进入 Completion Input；因此成员最后一次 `rovai send` 或公开 `@Lead` 必须包含
完整结论。每个 Item/generation 最多接受 16 条 captured return，这些回传不占普通 A2A 配额；普通成员派发
上限不变。成员 Run 终态才关闭对应 Item；没有显式回传时，Rovai 使用有界最终总结兜底。

所有 Item 终态后，Rovai 把完整原始 Gather 请求和当前 generation 的冻结结果作为 mandatory Current Input，
按原 initiator Conversation 的普通 FIFO 只创建一个 Lead continuation。Default Lead 后续更换不会转交该
completion；原 initiator 离开、用户 Stop 或 Camp 关闭会取消 Gather。

以下情况不要使用 Gather：

- 单个或多个成员各自处理一次性请求，但 Lead 不需要等待全员后统一续跑：使用 [Send](send.md)。
- 责任需要跨 AgentRun 独立追踪、交接或验收：使用 [Task](task.md)。
- 成员已经全部回复，只需要当前 Lead 直接综合：不要再创建 Gather。
