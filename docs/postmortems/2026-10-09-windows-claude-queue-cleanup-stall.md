---
document_type: postmortem
incident_id: INC-2026-10-09-WINDOWS-CLAUDE-QUEUE-CLEANUP
incident_date: 2026-10-09
status: resolved
systems:
  - claude-code-runtime
  - managed-runtime-process
  - runtime-cleanup
  - delivery-queue
last_updated: 2026-10-10
---

# Windows Claude Code 回复完成后，后继 Run 长期排队

> **爱丽丝的小结：** 这次卡住的关键不在模型有没有回答，而在 Rovai 能不能确认上一轮已经收尾。
> 我们把不保证完整送达的进程通知当成了必须凑齐的证明，又让这份证明阻挡业务结果结算和下一条任务。
> 修复同时收敛清理判据、分开业务终态与资源清理，并用“第二条实际自动执行”验证恢复，不能只看首条回复已经出现。

## 摘要

用户报告：Windows 上，非队长 Claude Code 队员已经给出结论、不再继续输出，但下一个分发任务一直排队；
手动停止也不能使下一条运行，退出并重新打开软件后才继续。用户使用 Claude Code 接入的 DeepSeek 模型。

隔离诊断在 Rovai 0.4.6 Core 和当时主线 `b0bed16a` 复现了这一现象：第一条回复已发布，首个 Run 仍为
`running`，首条 Delivery 为 `claimed`，第二条为 `waiting`。根因是 Windows Job 清理确认依赖完整进程通知，
通知缺失会让已经没有活跃进程的 Job 永远无法通过检查；Claude 的收尾超时又使已接受输入保持未决，后继调度被阻挡。

修复提交为 `7429216d6`，通过 [PR #677](https://github.com/murray17/rovai-ai/pull/677) 合入 main。
修复纳入 `v0.4.7` 代码与[发布说明](../../build/release-notes.md)。这里的“已修复”指已确认缺陷的实现和记录中的验收闭合，
不表示全部用户都已升级，也不表示所有 Windows 版本、模型和权限组合均已实测。

## 影响与证据边界

| 项目 | 已知事实 |
| --- | --- |
| 用户影响 | 后继任务不能自动启动；界面长期显示执行中或排队；用户被迫手动停止或重启 |
| 故障层 | Claude 原生结果读取之后的 Windows 受管进程清理与 Core 调度交接 |
| 已复现范围 | Windows 隔离 Core、非队长 Claude 队员；同一测试环境有正常试次，属于间歇性故障 |
| 权限／沙箱 | 诊断使用 `bypassPermissions`，本机 Claude 设置没有 `sandbox` 项；二者不是这条复现路径的必要条件 |
| 模型边界 | 初始诊断未直接测试用户的 DeepSeek 配置；本机使用可用的 Sub2API 模型，不能据此宣布所有模型配置无问题 |
| 角色边界 | “队长没事”是用户观察；没有证据证明缺陷只影响非队长，不能据此新增角色特判 |
| 无法量化 | 受影响用户数、全局发生率、最长等待和额外额度消耗没有可靠统计 |

本复盘依据代码差异、合并记录、当时的隔离验收记录和公开 Thread 诊断整理，未为写报告重新调用付费模型。
原始反馈见 Thread `rvcamp_01m4ff39nwfbs91rmqgxb5s9bs` 的消息
`ac807542-6047-453c-b999-66937787fdef`（序列 1）；其中包含当时诊断者的复现说明。

## 故障链与根因

```text
Claude 返回原生结果，回复可见
    → Rovai 等待 Windows Job 清理确认
    → 实际活跃进程已为 0，但收到的进程通知数量不足
    → tree_is_empty() 持续返回 false，清理超时
    → 原 Run／已接受输入没有正常收敛
    → 后继 Delivery 保持等待，不能自动运行
```

### 1. 用不保证完整的事件流证明完整退出

旧实现除检查 `ActiveProcesses == 0` 外，还累计普通完成端口的新进程通知、保存逐进程退出见证，
并要求观察到的成员数与 Job 生命周期累计 `TotalProcesses` 一致。

独立诊断试次记录：Job 活跃进程为 **0**、累计进程为 **91**、观察到的新进程通知为 **90**，
已观察进程的待退出核验数为 **0**。因此，“还缺一条通知”被解释成“还不能确认清理”。
这组计数来自另一诊断试次，不能拼接成最初那个 Run 的完整单次追踪；根因判断由它、状态复现和旧代码条件共同支持。

微软说明，除指定的限制通知外，普通 Job 完成端口通知不保证送达；未收到通知不能反推事件没有发生。
因此，等待完整通知计数并非一个最终一定能满足的收尾条件。[Microsoft Learn](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_associate_completion_port)

### 2. 业务结果与资源清理被绑定成一次成功

Claude 的可信原生终态已经到达，清理失败仍可能使执行路径返回错误，已接受输入保留未决状态。
用户看到“结论已经出来”，Core 却尚未完成对应业务结算。这不是简单的状态文字刷新遗漏。

资源没有确认释放时，阻止后继执行有其必要性；问题是把它同时当成否定可信业务终态的理由，且清理判据可能永远无法满足。

### 3. 收尾边界的验收不足

已有测试关注进程树归属、孙进程退出和取消安全，但旧判据没有覆盖“通知不完整、当前 Job 已空”的可用性结果。
单次模型回复成功也不能证明队列恢复，必须继续观察第二条 Delivery 真正被领取并执行。

## 修复方式

| 改动 | 修复后的行为 | 实现证据 |
| --- | --- | --- |
| 收敛当前 Job 清理判据 | 本次有效 Job 查询成功且 `ActiveProcesses == 0` 才确认；移除累计计数、普通通知和逐进程句柄的额外完成门槛 | [Windows Managed Process](../../crates/rovai-core/src/managed_process/windows.rs) |
| 分开业务终态与清理 | 原生成功／失败按可信终态结算；未确认清理另保留精确 Run/epoch 的门禁和 owner | [Claude 执行收尾](../../crates/rovai-core/src/claude.rs)、[Core 结算与清理](../../crates/rovai-core/src/application.rs) |
| 有界清理与局部重试 | 正常结束、Stop 共用清理机制；Windows 单次总预算五秒，未确认时由既有 worker 重试，ACK 后唤醒后继调度 | [修复提交](https://github.com/murray17/rovai-ai/commit/7429216d6134f65785542df8d1f33038ae3c4c18) |
| 保留排队请求 | 等待清理期间不丢弃后继请求；临时启动文件删除失败只记诊断，不推翻可信结果 | 同上 |
| 明确等待原因 | 执行台区分普通排队、等待清理和清理未确认重试 | [ThreadWorkspace](../../apps/desktop/src/renderer/src/ThreadWorkspace.tsx) |

这不是以“超时到了”强制认定成功。查询失败、仍有活跃成员或缺少有效 owner 时，仍不能放行。
跨 Core 恢复所需的精确 Run/epoch 持久清理回执继续保留；当前 Job 查询规则不等于“Job 名称消失即可证明退出”。
当时先前规则与最终取舍的变更已记录于 [V1.72-D20](../versions/v1.72/decisions.md#v1-72-d20)，
当前约束见 [Managed Runtime Process v2](../contracts/managed-runtime-process-v2.md) 和
[Cancellation Settlement v2](../contracts/cancellation-settlement-v2.md)。

## 时间线

以下时间使用 Asia/Shanghai。首次反馈与修复完成之间的时间不是全体用户的故障持续时间。

| 时间／阶段 | 事件 |
| --- | --- |
| 2026-10-09 12:35 | 本地公开 Thread 收到用户转述与隔离诊断，确认回复可见但后继任务等待 |
| 修复前 | 0.4.6 与 `b0bed16a` 出现间歇复现；独立试次记录 Job 的 91／90 通知差额 |
| 2026-10-09 13:55 | 提交 `7429216d6`，调整清理判据、业务结算与调度交接 |
| 2026-10-09 14:17 | PR #677 合入 main，合并提交 `e1d6f3e96` |
| 2026-10-10 | `v0.4.7` 代码和发布说明已包含该修复；本复盘完成事实整理 |

## 验证结果与未覆盖项

下表是 [PR #677](https://github.com/murray17/rovai-ai/pull/677) 和
[版本验收记录](../versions/v1.72/implementation-plan.md) 中的历史结果，本次只做证据核对。

| 验证 | 结果与范围 |
| --- | --- |
| 正常结束后自动执行下一条 | Windows 10 22H2（19045）、隔离 Core 0.4.6 开发构建、Claude Code 2.1.288；第一条执行时提交第二条，两条均 `succeeded`，无需重启 |
| Stop 后自动推进 | 取消命令两次记录分别为 26 ms、23 ms；第一条 `cancelled`，第二条自动 `succeeded` |
| 旧工具不再产生延迟写入 | Stop 后观察 22 秒，预定的延迟写入没有出现；不能把取消 RPC 的快速返回误作同步完成了全部清理 |
| 定向与共享回归 | PR 记录 Claude 扩展 34 项、Windows Managed Process 12 项、Runtime Fleet 23 项、Codex 21 项，以及 workspace、前端、格式和文档门禁通过 |
| 尚未覆盖 | 该轮未实测 Windows 11、打包客户端、其他模型和权限模式；持续 Job 查询失败的现场恢复仍需诊断证据 |

原始验收报告在当时会话附件中名为 `claude-final-normal-report.json`、`claude-final-stop-report.json`。
本复盘未独立读取这两份 Windows 原始文件，不把版本文档的记录说成本轮重跑结果。

## 纠正措施与经验

| 措施 | 状态 | 可检查的完成依据／后续责任范围 |
| --- | --- | --- |
| 去掉不可靠通知计数的完成门槛 | 已完成 | PR #677；Job 当前状态 owner 回归 |
| 可信业务终态与清理门禁分别结算 | 已完成 | Claude 与 Core 对应路径、精确 Run/epoch 回执 |
| 验收必须包含后继任务实际执行 | 已完成本轮场景 | 正常结束和 Stop 两份隔离记录；后续 Runtime 维护继续沿用 |
| 扩展用户实际模型、Windows 11 与安装包交互 | 待补充证据 | Runtime／发布验收维护范围；本报告不把尚未安排的验证标记为已完成 |
| 保留查询异常的明确诊断 | 已实现，持续观察 | 定位到 Run/epoch 的局部重试，不能重新引入无限等待或静默放行 |

本次最重要的教训是：**安全的清理门禁也必须有可靠、可达的完成条件。**
业务回复、原生终态、资源释放和后继调度需要分别核验；“首条已经回答”不能替代完整队列验收。
本文是事故历史，不新增产品合同，也不授权清理用户日常数据。
