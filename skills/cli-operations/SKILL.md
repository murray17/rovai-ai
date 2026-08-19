---
name: cli-operations
description: 当不确定当前工作应使用 CampMessage、Gather、持久 Task、Camp/History 检索还是 Memory，需要由 Default Lead 并行征集多个成员后统一综合，普通消息是否应升级为 Task，一次业务事件需要协调多个 Rovai 操作，或 CLI 返回后需要根据最新状态选择恢复动作时使用。普通单一操作及其具体收件人或参数应直接查看对应操作帮助，不要因此自动加载本 Skill。
---

# Rovai CLI 操作协调

## 快速路径

如果需求已经明确对应一个普通单一操作，不要继续加载本 Skill 的 references。运行 `rovai --help`
选择 operation，再运行该 operation 的精确 `--help`；不要假设 command family 有独立 help entry。

## 选择操作

先判断用户需要留下什么领域事实：

- Camp 中可见的答复、状态、问题或一次性协作消息：选择 CampMessage。
- 当前 Default Lead 要把同一主题并行交给多个成员，并在全部成员 Run 终态后只收到一次统一续跑：选择 Gather。
- 跨 AgentRun 仍需追踪、可独立交接和验收的责任：选择 Task。
- 查找 Camp、消息或稳定 ID 对应的历史事实：选择 Camp/History 读取。
- 跨未来 AgentRun 仍有价值的稳定偏好、约定或经验：转交 Memory 治理判断。

边界不清时，优先选择最小且能完整表达用户意图的领域对象。不要用 Task 代替普通公开消息，也不要用
Memory 代替 Task、项目文档或历史证据。

## 协调多步流程

1. 先读取做决定所需的权威状态，再执行 mutation。
2. 为每一步选择一个具体 operation，并查看它自己的精确 `--help`。
3. 每次调用只使用该 operation 接受的一种输入来源。
4. 检查 compact business result；只有已提交的 operation 可以作为后续步骤的事实。
5. 如果当前责任需要 Camp 中的公开答复，在结束前成功发送 CampMessage。

一次 operation 成功只证明该 Rovai operation 已提交，不证明下游执行完成、整体工作质量、测试、评审
或用户意图已经满足。

## 按需读取

- 需要决定公开消息、Agent routing、User attention 或是否无需 Task 时，读取
  [Send](references/send.md)。
- 需要并行征集成员结果并让原 Lead 稍后统一综合时，读取 [Gather](references/gather.md)。
- 需要判断消息是否升级为持久责任，或协调 Task 与消息 linkage 时，读取
  [Task](references/task.md)。
- 需要在当前 Camp、指定 Camp、跨 Camp 历史或稳定 ID exact read 之间选择时，读取
  [Camp 与 History](references/camp-history.md)；该 reference 同时定义裸 `rovai camp read` 的默认
  Timeline 行为、message-anchored 显式模式和 cursor 延续规则。
- 需求可能属于长期记忆时，读取 [Memory 路由](references/memory.md)，随后使用
  `$memory-stewardship`；此处不替代 Memory 治理。
- CLI 返回 `error.recovery`，尤其要求 refresh 或确认结果时，读取
  [Recovery](references/recovery.md)。

多步需求可以读取多份直接相关的 reference；不要为了普通单一 operation 预读全部文件。
