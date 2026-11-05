---
document_type: interface-contract
contract: user-automation
version: 6
authority: desktop-user-automation-and-evaluation-host
status: accepted
source_version: v1.59
last_updated: 2026-11-05
---

# User Automation v6

继承 [v5](user-automation-v5.md)，扩展显式注册的 Weekly 时间策略，命令与用户 IPC 运输 shape 保持不变。

`rovai app eval schedule` 验证 [Execution Evaluation v15](execution-evaluation-v15.md) 的无时间上限模板后，
通过 [Scheduled Automation v2](scheduled-automation-v2.md) 将对应定义的时间上限设置为 null，绑定返回的
Automation version。普通有限模板保持 2700 秒准入上限及一小时 Automation 时限；重新绑定不能改写活跃 job。

新绑定保存 `timeoutSeconds` 并通过 `eval status` 的 schedules 返回。配置失败不宣称绑定成功；若 Core 配置
已成功而文件写入失败，保留明确错误并允许用户重新执行绑定，不伪造 job、报告或回执。

无时间上限 job 不创建宿主 elapsed timer；每轮从当前显式注册源码构建并冻结新的真实产品。模板、执行器或
Judge 变更后仍须重新登记与绑定。取消、App 关闭、父进程消失、worker 故障和重启中断继续清理子进程、保留
本次真实终态回执。等待器无固定 55 分钟截止，仅解释匹配 Camp 与工作区的回执，不能使用上次报告替代。

`rovai app` 的受管 Runtime 防误调用保持不变；登记须由用户普通终端执行，不通过清除环境标记绕过。

## Hermes 显式恢复

未上线的 hermes-inspect/hermes-discard 及私有恢复 RPC 已退出生产接线，不保留兼容分支。
原生 unknown 保留事实，按官方入口明确处理，不自动换 Session 或重放任务。
Hermes 原生会话 CLI 环境仍禁止用户级 `rovai app`。
详见 [Hermes 未知执行合同](hermes-managed-runtime-v1.md#用户明确处理未知执行)。

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

CLI 仍要求 Desktop 正在运行并使用当前用户的私有 IPC credential；受管 Runtime 仍禁止 `rovai app`。
本功能不增加远程匿名入口，不提供跨 OS 用户鉴权，也不能证明调用 CLI 的外部程序确为某种 Runtime。

```sh
rovai app thread send --thread-id <thread-id> --agent-id <recipient-id> \
  --sender-agent-id <sender-id> --body-file ./report.txt --timeout 30m
```
