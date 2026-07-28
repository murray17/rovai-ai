---
document_type: adr
id: ADR-0062
title: "Interruptible Run Trees and Unsettled External Effects"
status: accepted
date: 2026-07-28
decision_scope: cross-version
source_version: v0.17
supersedes: []
superseded_by: null
---

# ADR-0062: Interruptible Run Trees and Unsettled External Effects

## Context

现有取消路径把“AgentRun 能否进入取消终态”与“所有 Runtime 投递、Action 或外部
效果是否已经确定”绑定在一起。只要存在 `delivery_unknown`、正在执行或结果未知的
外部操作，Core 就可能拒绝取消，界面因此长期停留在运行中，用户也无法恢复发送。

这混淆了两个不同事实：

1. Rovai-ai 是否仍允许这棵执行树继续产生消息、Team Tool 调用和后续 Run；
2. 已经交给外部 Runtime 或工具的操作是否真正停止、是否产生了不可撤销效果。

Rovai-ai 可以可靠地终止自己的执行权和后续提交，却不能承诺撤销已经交给外部系统
的副作用。产品需要诚实表达这种不确定性，而不是为了等待确定结果而拒绝用户停止。

## Decision

### Stop 作用于整个 CampTurn 执行树

用户停止一个活动 CampTurn 时，Core 对该 CampTurn 内所有非终态 AgentRun 以及由其
A2A 派生的后代建立同一取消意图。取消请求一旦被 Core 接受：

- 立即提升相关 Run 的 execution fence/epoch，使旧回调失去写权限；
- 禁止这些 Run 再写公共最终消息、Execution Evidence、Task mutation、
  `team.post_message` 或创建新的 A2A 后代；
- 对仍连接的 Runtime 发出其原生 interrupt/cancel；
- 对排队、等待、恢复中或当前没有可中断进程的 Run 直接关闭继续执行资格；
- 幂等重复停止返回同一取消结果，不创建第二棵状态机。

停止是 CampTurn 级执行控制，不自动取消或改写 Task，不删除已经产生的消息、证据、
Approval、Action 或审计记录，也不回滚外部文件或网络效果。

### 执行终止与效果确定性分离

Run/CampTurn 在 Rovai-ai 已完成 fencing、关闭新工作入口并处理当前 Runtime
interrupt 后即可进入取消终态。未知 Runtime 投递、外部 Action、命令或工具效果留在
它们自己的权威记录中继续标记为 executing/unknown/recovery；它们不再作为
AgentRun 取消终态的 blocker。

Read Side 必须分别表达：

```text
executionState = cancelled
hasUnsettledExternalEffects = true | false
```

当第二项为真时，普通 UI 显示“已停止 · 结果待确认”及可访问的警告说明。不得把它
显示成“未执行”“已回滚”或普通成功，也不得自动重试不确定投递或外部操作。

后续恢复只能对账和收敛原记录，不能恢复已取消 Run 的执行权。迟到的 Runtime
callback 可以用于更新其对应的效果/投递记录，但不得重新产生 Agent 消息、工具调用、
A2A 或执行过程。

### Composer 解锁边界

活动 CampTurn 的 Composer 输入保持可编辑且保留草稿，发送位置改为明确的危险
“停止”操作。只有用户点击或键盘聚焦后显式激活该按钮才会停止；
`Cmd/Ctrl + Enter` 在停止态不得触发取消。

当整棵 CampTurn 执行树已经 fenced 且所有 Run 不再拥有继续执行资格时，Composer
立即恢复发送，不等待未知外部效果最终对账。新提交创建新的 CampTurn/AgentRun 和
execution epoch；旧 Run 的任何迟到回调不能写入新 Turn。

## Consequences

- 用户能够可靠结束卡住、等待或结果不明的执行，并继续使用 Camp。
- “停止执行”不再被错误描述为“撤销外部世界”；未知效果有独立、持久、诚实的状态。
- Core 必须把取消请求、Runtime interrupt、fencing、Run 终态和效果对账拆成可恢复
  的步骤。
- 所有消息、Team Tool、Evidence 和 Runtime callback 写路径都必须校验当前 fence。
- UI 需要同时展示取消终态与结果待确认警告，而不是一个含义过载的状态徽标。

## Rejected Alternatives

- 有任一 unknown/executing 记录就拒绝取消：会永久占用 Composer，并把外部确定性
  错当成 Core 执行控制。
- 取消时把 unknown 强制改为未执行或失败：伪造事实，可能导致危险重试。
- 只停止当前前台 AgentRun：A2A 后代仍可继续写消息和创建新工作。
- 只发送进程信号而不建立 fence：迟到回调仍能污染已停止的 CampTurn。
- 等全部外部效果确定后再恢复发送：把独立的新工作无期限绑定到旧外部状态。
- 取消时自动回滚文件、Task 或网络操作：跨 Runtime 不可证明安全，也超出停止语义。

## References

- [v0.17 可中断执行与持久会话证据](../versions/v0.17/README.md)
- [ADR-0001: Core Transaction](0001-core-transaction.md)
- [ADR-0016: Multi-Runtime Execution Boundary v2](0016-multi-runtime-execution-v2.md)
- [ADR-0058: Collaboration v4](0058-collaboration-v4-presence-aware-admission.md)
- [ADR-0059: Runtime-Owned Resource Permissions](0059-runtime-owned-resource-permissions.md)
