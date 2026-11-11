---
document_type: interface-contract
contract: user-automation
version: 7
authority: desktop-user-automation-and-evaluation-host
status: accepted
source_version: v1.72
last_updated: 2026-11-10
---

# User Automation v7

继承 [v6](user-automation-v6.md)。本版以现有 Delivery-first Core 回执替代 v1 的即时
CampTurn/AgentRun launch 结果，并增加显式成员代发；IPC envelope 的 contractVersion 保持 1。
本版不修改执行预算、Delivery claim、Runtime 权限、模型输入格式或平台准入。

## 发送输入与回执

普通发送 `thread.send` 与成员代发 `thread.sendAsMember` 共用一次
`userAutomation.thread.send` Core command。省略 `executionBudget` 和显式 `null` 均表示使用
Core 既有缺省规则；对象原样传递，标量和数组仍拒绝为 `automation_invalid_input`。CLI 省略预算
参数时发送 `null`，带 `--timeout` 或显式预算时发送对象；不在 Main 新建或重算预算。

成功表示消息和目标 Delivery 已持久提交，不代表 Run 已创建、Runtime 已启动或任务已完成。
结果只有以下闭集，替代 v1 的 launch shape：

```ts
type AutomationSendResult =
  | {
      status: 'dispatched'
      threadMessageId: string
      sequence: number
      deliveryIds: string[]
      replayed: boolean
    }
  | {
      status: 'rejected'
      code: string
      message: string
      preflight: StartPreflightResult | null
      replayed: boolean
    }
```

`threadMessageId` 和 Delivery ID 必须非空，`sequence` 为正安全整数，`deliveryIds` 必须非空。
Main 只投影 Core 已返回的这些字段，不伪造 `threadTurnId`、`agentRunIds` 或预算 deadline。
CLI 对 `dispatched` 返回退出码 0，对领域拒绝返回 1；无效回执和非空 `pendingExecution`
仍以 `automation_contract_upgrade_required` 失败。IPC 断开或合同错误不能证明 mutation 未提交，
调用方不得据此自动换新 commandId 重发；相同 commandId 重放仍返回首个结果。

`status` 增加 `threadSendReceipt: 'delivery'`，用于让现有诊断消费者在写入前识别不兼容回执。
普通 `thread send` 不等待或猜测 Run 身份；依赖旧 Run 字段的外部脚本须按本版回执调整。

## 外部自动化代发成员消息

`rovai app thread send --thread-id <id> --agent-id <recipient-id>` 支持可选
`--sender-agent-id <sender-id>`，经 `thread.sendAsMember` / `userAutomation.thread.send` 的可选
`senderAgentId` 字段传入 Core。省略 CLI 参数时仍调用 `thread.send` 并保留现有 User 作者；正文和执行预算规则不变。
`thread.sendAsMember` 要求非空字符串发送者；旧 Desktop 对未知操作拒绝，CLI 不降级重试为 User 发送。
普通 `thread.send` 拒绝非 null 的 `senderAgentId`，Core 省略或 null 保留 User 作者。

指定发送者时，这是已认证本机 User 授权的代发，不是外部进程原生身份认证，也不是受管 AgentRun 的 Send。
只有当前 User actor 可调用此入口；发送者和接收者均须是目标 Thread 内 present、active、未请求离开的成员，
且不能相同。不可用发送者拒绝为 `automation.sender_unavailable`，自发自收拒绝为
`automation.self_address_not_allowed`；接收者沿用 `mention_target_unavailable`。拒绝不产生消息、Delivery、
Run 或 Composer 副作用，并保存可重放回执。相同 commandId 始终返回首个结果，改变发送者不会改写原消息或新建消息；新操作须使用新 commandId。

消息保存 `author_type=agent`、指定的 `author_id`、`origin_kind=automation`、空的
`source_agent_run_id`，不伪造 Run、lease 或 A2A lineage。审计 actor 仍为授权 User，
`source_operation_id` 关联原命令；消息不可作为 Composer 草稿撤回。
现有 Delivery 批处理和公共历史投影向接收模型提供真实 `senderType=agent`、`senderId` 和 `senderName`。
这条消息不代表新的 User 授权，接收者后续协作继续使用自己的受管 `rovai send`。

CLI 仍要求 Desktop 正在运行并使用当前用户的私有 IPC credential；受管 Runtime 和 Hermes 原生 local
会话仍禁止 `rovai app`。本功能不增加远程匿名入口，不提供跨 OS 用户鉴权，也不能证明调用 CLI 的外部程序
确为某种 Runtime。普通终端验收不等于 Hermes cron 场景已验收。

```sh
rovai app thread send --thread-id <thread-id> --agent-id <recipient-id> \
  --sender-agent-id <sender-id> --body-file ./report.txt --timeout 30m
```

## Diagnostic Trial 的兼容边界

旧 Trial 需要即时的单个 Run 身份与 Core deadline；当前发送回执均不包含这两项。
CLI 读取 `status` 后，在创建 journal、导出目录、Thread 或派发任务之前，对 Delivery、缺失或未知的回执
能力返回 `automation_contract_upgrade_required`，明确 Trial 尚未适配；`--no-wait` 同样拒绝。
只有显式声明 `threadSendReceipt: 'agent_run'` 的主机才可进入原 Run 回执路径；当前 Desktop 只声明
`delivery`，不以旧 Desktop 缺少能力字段推断它仍支持即时 Run。

本版不新增 Delivery 查询或观察接口，不通过 Thread 的第一个 Run、时间顺序、旧 Trace 表或事件猜测关联，
也不以本地等待期限伪装 Core deadline。已知 Run ID 的 `agent-run show/watch/export/cancel` 保持原合同。
该拒绝收敛已有的“先发出真实任务，再因缺少 Run 字段失败”，不宣称已恢复 Diagnostic Trial。
