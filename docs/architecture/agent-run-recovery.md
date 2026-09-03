---
document_type: architecture
architecture: agent-run-recovery
authority: agent-run-session-and-native-turn-recovery-boundaries
last_updated: 2026-09-01
---

# AgentRun Recovery

本文描述 Core 重启后 AgentRun、Native Session 与 Native Turn 的长期恢复边界。规范依据是
[Runtime 恢复与关闭不变量](foundational-invariants.md#runtime-recovery-shutdown)。受控关闭后的 product
fence 由 [Runtime 恢复与关闭不变量](foundational-invariants.md#runtime-recovery-shutdown)拥有；字段级状态与命令见
[Accepted Input Recovery v5](../contracts/accepted-input-recovery-v5.md)与
[Planned Shutdown v5](../contracts/planned-shutdown-v5.md)。

## 1. 三个独立恢复对象

```text
AgentRun durable state
  ├─ Native Session binding：可 load/resume 或安全替换
  ├─ Runtime Input Delivery：prepared / accepted / delivery_unknown 证据
  ├─ Attachment authorization：Manifest View Receipt / Runtime Auth Receipt
  └─ Native Turn：Provider 侧一次 prompt 的运行与 terminal result
```

Core 拥有 AgentRun 和 Runtime Input Delivery；Runtime Provider 拥有 Native Session 与 Native Turn。
Session 恢复只重新建立会话 handle，不能恢复旧 Host 内存中的 prompt route。只有经验证的 Adapter
`native_turn.reconcile.v1` 才能把同一旧 Turn 重新对账。

## 2. 启动恢复分类

Core 在普通 Startup Recovery Coordinator 之前先检查 pending `planned_shutdown_cycle`。cycle 覆盖的
AgentRun 通过 durable product fence 直接收敛为 terminal cancelled，同时保留 accepted/delivery-unknown
input 与 unknown external effects；它们不进入下面的普通分类，也不会恢复旧 Run 执行权。

非终态 `invocation_kind=single_chat` Run 同样在普通分类前直接使用既有取消结算；它只取消当前回复，保持
Single Chat Conversation active，并允许下一条用户消息建立新 Run。它不进入 accepted-input blocker、Native Turn
reconcile、私有 transcript replay 或专用恢复状态。完整边界见 [Single Chat Architecture](single-chat.md#取消和并发)。

没有 pending controlled-shutdown cycle 时，Startup Recovery Coordinator 在同一事务内先收敛 Action、
Approval、Runtime Delivery 和 prepared input，再分类 AgentRun：

- 无 accepted input 且没有其他 safety blocker：可以保持 `runtime_session_recovery` 语义，由 Scheduler
  领取并执行安全的 Session 恢复；
- 输入投递结果未知：保持 `delivery_unknown`，不得猜测 accepted 或未发送；
- 存在 accepted input，且不存在更具体的未决 Approval、Action、Runtime Delivery、prepared 或
  delivery-unknown input：进入 `waiting/recovery_blocked`；
- 存在 active unknown Action：继续由 Action Reconciler 拥有，不被 accepted-input blocker 覆盖。

`recovery_blocked` 的 `runtime_recovery_required` 必须为 false。第二次启动不得重新标记为自动恢复，
不得增加 execution epoch，也不得改变 accepted Delivery。

完成上述分类和 MessageDelivery 启动结算后，Core 在开放普通执行前，以事务收敛旧版本仅因失败 Run
的手动重试标记而残留 waiting 的 CampTurn。仅在 required 当前 Run 已失败、且该 Turn 没有任何
非终态 Run 或 MessageDelivery 时，复用正常 Turn 聚合结算；
真正的审批、恢复等待与执行占用不被绕过。重复启动不重写终态或重复记录结算事件，原失败证据、
私有 Pending 输入与编辑占用均保留；续发仍由正常 Scheduler 的准入负责，恢复本身不发送消息。

Migration 99/100 是两次 evidence-aware clean break：旧 Formatter 20 或 Manifest 20/Receipt v1 非终态输入在
相应 View migration 前按 delivery/action evidence 终结，accepted outcome unknown 绝不能降为 cancelled。旧
Manifest、payload Blob、Runtime Auth Receipt、ACK、Binding identity 和执行证据保留为 non-dispatchable history；
新的 Scheduler 只接受 Formatter 21/Manifest 21。

## 3. 调度与 Adapter 边界

Scheduler 只领取 queued，或确有自动动作的 `waiting/runtime_recovery` Run。accepted input filter 保留为
纵深防御；`recovery_blocked` 永不进入候选集合。Codex/ACP Adapter 遇到既有 accepted Delivery 时必须
fail closed，不得发 `agent_run.input_resumed` 或等待一个不存在的旧 Host response route。

当前输入 retry/resume 必须保持冻结 attachment refs、legacy receipt 自身 digest 与精确模型 bytes，但不再要求
当前 legacy View ready、append-only successor 或 generation 匹配。新的 Runtime Attachment Auth Receipt 重新验证
同一 admitted Runtime Files Root identity 与精确 Camp root，使用 `live_append_v1` 且无 compatibility generation；
不得重新选择 Context、生成新路径、探测 payload 或把 Authority Attachment path 当降级入口。Managed v2 路径使用
同一稳定 Camp root 和持久 locator，不进入 legacy generation/Entry receipt。

未来若某 Adapter 通过 P1 实验，Core 才能为它增加独立的 `native_turn_reconciliation` 状态与 Coordinator。
该 Coordinator 只能 lookup/reattach 同一 Provider Turn，不能调用新的 prompt API。

## 4. 用户与预算收敛

Renderer 从 Snapshot 读取 blocker，不推断恢复进度。用户执行
`agentRuns.resolveRecoveryBlocker` 后，Core 原子写入：

```text
AgentRun.status = failed
last_error_code = accepted_input_outcome_unknown
manual_retry_allowed = false
accepted Runtime Input Delivery = unchanged
CampTurn = recomputed
```

required Run 失败后，等该轮所有当前 Run 责任与 MessageDelivery 结束，CampTurn 正常聚合为 failed。
`manual_retry_allowed` 与 `retry_declined_at` 仅保留历史失败元数据，不代表执行占用，也不要求用户
调用不存在的 Run 重试入口。Core 不重跑失败消息或自动创建 successor；
[Pending Camp Input](../contracts/pending-camp-input-v1.md#自动续发错误和幂等)在该轮结算后按 FIFO 续发。

CampTurn Stop、AgentRun 局部 Stop 与 Execution Budget 到期调用同一事务结算；目标 Run 一律为 cancelled，
accepted/delivery_unknown Input 与可能派发的 Action 仍作为底层审计证据保留，禁止自动重发。整轮 Stop 使 Turn
cancelled，预算到期使 Turn failed；Run-local Stop 保留 required/optional 聚合，只在所有责任结束后进入 Turn
终态，合法渠道输出仍须正常送完。取消证据不产生公共“外部效果待确认”提示；普通 Recovery Blocker 的显式结束
仍为 failed/accepted_input_outcome_unknown。
Runtime reaper 不再承担业务结算。发送前条件更新及迟到证据边界见
[Accepted Input Recovery v5](../contracts/accepted-input-recovery-v5.md)。
`recovery_blocked` 不提供普通 Run Stop，仍只允许既有“结束此运行”把 blocker 收敛为 outcome unknown。
用户若要继续，必须检查 Workspace/Git/外部效果现场并发送新的后续任务；Core 不自动创建 successor。

## 5. 证据与观测

- `accepted` 回执证明 Runtime 接受过输入，不证明模型读取、工具完成或 terminal result；
- Runtime correlation ID 不自动升级为 Provider Turn ID；
- Execution Evidence、ContextManifest、Git Observation 和 Workspace 现场不因 blocker resolution 删除；
- UI 的“结果待确认”是领域状态投影，不是 Runtime 正在执行恢复动作的动画状态。
