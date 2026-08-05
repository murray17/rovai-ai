---
document_type: version-architecture
version: v0.38
authority: version-implementation-design
status: frozen
last_updated: 2026-08-05
---

# v0.38 实施设计

## 权威边界

- `task` 行是标题、描述、负责人、状态、版本和时间的当前权威。
- `event_log` 中的 `task.created`、`task.updated` 与命令结果保留 Actor、顺序、结果和版本审计。
- CampMessage 只承载公共会话内容，不再镜像普通 Task 生命周期。
- `team.update_task` 的字段、授权、expected-version CAS、幂等和终态规则不变。

该边界与 ADR-0067 一致：Agent 需要当前 Task 时通过鉴权后的 `team.list_tasks` 读取，不依赖
共享会话中的状态镜像。

## 写路径

`create_task` 在同一命令事务中创建 `pending` Task 并追加 `task.created` 领域事件，不创建
CampMessage。`update_task` 原子修改提供的标题、描述、负责人或状态并追加 `task.updated`，
同样不创建 CampMessage。完成和取消没有额外会话写入。

## Renderer 投影

Camp Snapshot 已同时包含当前 `tasks` 和有限审计窗口 `timeline`，无需新增 IPC 或 Schema：

1. 每个当前 Task 生成稳定 ID 为 `task:{taskId}` 的唯一 `task_card`；
2. 若审计窗口含对应 `task.created`，使用其 `globalSequence` 作为排序锚点；
3. 若较早创建事件已超出审计窗口，使用 Task `createdAt` 作为稳定回退；
4. 卡片内容始终读取当前 Task Snapshot，因此更新不改变卡 ID 或创建位置；
5. 历史 CampMessage 中 `presentation.kind = task_event` 的行从会话投影中过滤；
6. 点击卡片仍以 Task ID 打开 Inspector 当前详情。

## 历史与持久化

不做破坏性 Migration。旧 Task CampMessage、presentation payload、消息序号和索引全部保留，
供历史数据库完整性与审计排查使用；它们不再是 Renderer Task 展示源。Task 详情和审计页继续
读取原有 Read Side，不建立第二份可变历史数组。

## 不变量

- 一个 Camp 中每个 Task 最多一张会话卡；
- 创建即有卡，首次状态变化不是卡片出现条件；
- 标题、负责人和四态更新不移动卡片；
- 描述、数值进度和 Run 状态不进入卡片；
- Task 更新不会增加 CampMessage、启动 Run、发送 InboxMessage 或唤醒 Runtime。
