---
document_type: contract
contract: scheduled-automation-v1
status: accepted
target_version: v1.50
last_updated: 2026-09-05
---

# Scheduled Automation v1

本合同定义 Desktop/Core 内的本机定时 Automation。它与普通用户的 `rovai app` IPC Automation 是不同领域；
每次执行仍复用普通 Camp、CampTurn、AgentRun、Runtime 和渠道 Bot。

## 1. 定义与执行快照

Automation 定义至少包含：

```text
id, version, name, prompt, enabled, memberId, projectRef,
schedule, notifyChannels, nextRunAt, lastRun, createdAt, updatedAt
```

`projectRef` 是 `{kind: quick_chat}` 或 `{kind: directory, path: canonicalAbsolutePath}`。目录在写入定义时必须存在并
完成规范化；Quick Chat 在派发时解析为当前安装的数据目录。`notifyChannels` 是去重后的 `feishu | dingtalk` 集合。

名称去除首尾空白并折叠内部空白，最多 80 个 Unicode scalar。创建时名称为空则从规范化 Prompt 取前 20 个
Unicode scalar，剩余内容以 `…` 表示。普通 Prompt 编辑不改名；显式提交空名称时按新 Prompt 重新派生。

每个计划 occurrence 的稳定身份是 `(automationId, scheduledFor)`，其中 `scheduledFor` 使用 UTC RFC 3339。
领取时冻结以下字段，后续定义编辑不得改变它们：

```text
automationVersion, prompt, memberId, projectRef, scheduledFor, notifyChannels
```

一个 Automation 同时最多存在一个 `running | cancelling` AutomationRun。AutomationRun 以 `campTurnId` 为执行
业务锚点；`rootAgentRunId` 只用于确定唯一结果。

## 2. 计划与错过触发

支持六种计划：

- `daily(at)`、`weekdays(at)`、`weekly(weekday, at)`；
- `once(date, at)`；
- 标准五段 `cron(expression)`，顺序为 minute/hour/day-of-month/month/day-of-week；
- `manual`，只允许显式立即运行。

`date` 和 `at` 按设备当前时区解释；不存在的本地时间向后寻找第一个有效分钟，重复本地时间选择较早瞬间。
持久化 occurrence 和 `nextRunAt` 统一为 UTC。

第一版只在 Rovai Desktop/Core 正常运行且设备唤醒时触发，不在退出或休眠期间逐条补跑。恢复后：

- 只为最近一次已错过的 occurrence 写入 `skipped(reason=missed)`，更早 occurrence 不建行，然后直接推进到未来；
- 到点已有同 Automation 活跃运行时写入 `skipped(reason=overlap)`，不延后补跑；
- `once` 在正常领取、missed 或 overlap 任一消费后设置 `enabled=false, nextRunAt=null`。

UI 主状态只需显示“已跳过”，详情可以区分 missed 和 overlap。

## 3. 领取与原子派发

调度器用 SQLite immediate transaction 串行领取。一个成功执行的领取事务必须原子完成：

1. 创建 AutomationRun 并冻结快照；
2. 推进 Automation 的 `nextRunAt`；
3. 创建一个新的普通 Active Camp 和所选队员 CampMember；
4. 创建所选队员 Conversation、首条用户 CampMessage、CampTurn 和 root AgentRun；
5. 在 CampTurn 与 AutomationRun 两侧写入唯一 `automationRunId/campId/campTurnId/rootAgentRunId` 关联。

事务提交以后 Runtime Scheduler 才能领取 root AgentRun。`automationRunId` 是派发目标的唯一关联标识，任何运行最多
创建一个 Camp。首条 AgentRun purpose 固定为：

```text
This is a scheduled Rovai run. Execute the saved instruction once and return the final result.
```

派发准入前失败可以形成 `failed(runtime_not_ready | dispatch_rejected)`，且不保留未关联的 Camp 图。定义 mutation 采用
`expectedVersion`；版本冲突必须先重读。Built-in command envelope 继续提供同 command ID 幂等重放。

## 4. 状态、取消与恢复

AutomationRun 状态为：

```text
running | cancelling | completed | failed | skipped
```

结算规则：

- CampTurn `completed` 且找到唯一公共结果：`completed`；
- CampTurn `failed | cancelled`：`failed(reason=execution_failed)`；
- 任一同 CampTurn AgentRun 结构化进入用户输入或审批等待：`cancelling`，精确取消后
  `failed(reason=interaction_required)`；
- 超过冻结后台时限：`cancelling`，精确取消后 `failed(reason=timeout)`；
- CampTurn 完成但没有合格公共结果：`failed(reason=no_result)`。

Automation 内部取消入口只能取消当前 AutomationRun 精确关联的 CampTurn，原因只允许
`interaction_required | timeout | interrupted`，不修改用户手动停止权限。取消事务提交即代表 CampTurn 已进入权威终态；
随后 AutomationRun 才结算并释放活跃门禁。现有 execution fence 拒绝迟到回调；V1 不新增 cleanup fence，也不等待
Runtime 进程物理退出。

Core 重启只做状态收口，不重新派发：

- 没有 `campTurnId`：`failed(interrupted)`；
- CampTurn 未终态：精确取消后 `failed(interrupted)`；
- CampTurn 已终态：按 CampTurn 权威结果结算。

AutomationRun 进入终态后不可恢复；迟到事件可以保留底层证据，但不能把 failed 改回 completed。

## 5. 唯一结果消息

结算事务与 AutomationRun 终态一起冻结一个 `resultMessageId`：

1. 优先使用 `root AgentRun.finalCampMessageId` 指向的合格消息；
2. 否则取该 root AgentRun 最后一条合格 CampMessage；
3. 仍不存在则 `failed(no_result)`。

合格消息必须正式发布、未删除、公开且没有 Agent 收件人，并由该 root AgentRun 产生。A2A 消息、子 AgentRun 消息、
私有 Runtime 输出以及用户后续交流都不属于本次结果。

## 6. 渠道通知

V1 固定向所选队员对应渠道 Bot 的 Owner 私聊发送，不提供额外接收目标。运行进入终态时为每个所选渠道建立独立
NotificationDelivery；发送前重新检查当前已发布 Bot、凭据和 Owner provider identity。

- 运行成功发送冻结结果；运行失败发送失败状态；skipped 不发送；
- 每个渠道最多尝试三次，通知失败只重试通知；
- 运行成功但通知失败时 AutomationRun 仍为 completed，读取模型显示“运行成功 · 通知失败”；
- 定义删除不删除已存在的运行、Camp 或投递证据。

## 7. 管理与 CLI

Rovai 是单用户本地应用，V1 不增加 Principal、Owner 或项目 ACL。Core 每次验证 ID、版本、队员、项目、渠道和参数；
定时执行授权来自已启用并持久化的定义。Agent CLI 继续受当前 AgentRun、lease、Camp membership 和 CLI 权限边界约束，
且只有用户明确要求时才调用 `create | run | close | update | delete`。

CLI 命令为：

```text
rovai automation list
rovai automation get <automation-id|current>
rovai automation create --prompt ... --repeat ...
rovai automation run <automation-id|current>
rovai automation close <automation-id|current> --expected-version N
rovai automation update <automation-id|current> --expected-version N ...
rovai automation delete <automation-id|current> --expected-version N
```

`member=current` 指当前 Agent；`project=current` 继承当前 Camp 的稳定 binding，`quick-chat` 使用托管 Quick Chat，绝对
路径建立 directory ref。V1 不按 `origin=automation` 对后台 AgentRun 增加额外只读或禁写规则。

## References

- [Scheduled Automation Architecture](../architecture/scheduled-automation.md)
- [Built-in Tool Transport v22](builtin-tool-transport-v22.md)
- [Camp Identity v1](camp-identity-v1.md)
- [Cancellation Settlement v2](cancellation-settlement-v2.md)
