---
document_type: architecture
architecture: agent-run-recovery
authority: agent-run-session-and-native-turn-recovery-boundaries
last_updated: 2026-09-06
---

# AgentRun Recovery

本文描述 App/Core 持续运行期间的网络中断恢复，以及 Core 重启后 AgentRun、Native Session 与 Native Turn 的长期恢复
边界。规范依据是
[Runtime 恢复与关闭不变量](foundational-invariants.md#runtime-recovery-shutdown)。受控关闭后的 product
fence 由 [Runtime 恢复与关闭不变量](foundational-invariants.md#runtime-recovery-shutdown)拥有；字段级状态与命令见
[Accepted Input Recovery v5](../contracts/accepted-input-recovery-v5.md)与
[Planned Shutdown v6](../contracts/planned-shutdown-v6.md)；运行中网络恢复的精确合同见
[Network Interruption Recovery v1](../contracts/network-interruption-recovery-v1.md)。

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

## 2. 运行中网络中断恢复

网络恢复不从历史失败扫描，也不创建新 Run 或 replay Evidence。ACP Prompt 在 failed terminal 且当前 epoch Input
Delivery 明确 `not_accepted` 时，先完成旧 Prompt route 与 Host 可见性清理；若 structured code 优先的严格 classifier
确认 connection failed/reset、temporary DNS failure 或 network timeout，Core 在普通 terminal settlement 前把同一
AgentRun 转为 `waiting/network_recovery`。

generation-local `NetworkRecoveryQueue` 只保存 Run/epoch、Adapter、category、source、attempt、deadline、in-flight 与
connectivity-hint-consumed。
延迟固定为 `1, 2, 3, 5, 10, 15, 30, 30...` 秒，从上次 attempt 失败结束时起算。online 与 system resume 只使非
in-flight deadline 提前到 now；同一故障周期至多消费一次提示，后续失败 epoch 继承已消费标记，持续 signal 不会
逐档绕过退避。真正恢复仍先通过 system-only domain admission，再移交既有
`waiting/runtime_recovery` Scheduler。Scheduler/Fleet 的 claim、epoch、lease、并发与 accepted-input fence 保持唯一
执行权威。

每次 admission 重读 Run/Turn、版本、epoch、取消、预算、成员、授权、Delivery 与未决 Approval/Action/Runtime
Delivery。只有无 Delivery、明确 `not_accepted` 或尚未跨 dispatch boundary 的 `prepared` 可继续；accepted、unknown、
未决效果或身份变化停止自动恢复。安全条件变化但仍需人工收口时投影 `network_recovery_blocked`，并保留普通 Run Stop。
新 epoch 只有在 Runtime Input 正式 accepted 后才清除网络故障周期；Host/Session/连接建立本身不够。

Claude Code 已报告原生 API retry 时仍由 Runtime 拥有恢复，Core 不登记第二个 timer。当前 Rovai 接管只覆盖 ACP
terminal/not-accepted seam；其他 Adapter/phase 不因 `retryable` 或进程消失被自动重发。Core exit 清除内存 queue；
若 durable Run 留在 `network_recovery`，下次启动先归一为现有 `runtime_recovery` 再按下面规则分类，不恢复 attempt 或
deadline，也不建立跨重启保证。

## 3. 启动恢复分类

Core 在普通 Startup Recovery Coordinator 之前先检查 pending `planned_shutdown_cycle`。cycle 覆盖的
AgentRun 通过 durable product fence 直接收敛为 terminal cancelled，同时保留 accepted/delivery-unknown
input 与 unknown external effects；它们不进入下面的普通分类，也不会恢复旧 Run 执行权。

非终态 `invocation_kind=single_chat` Run 同样在普通分类前直接使用既有取消结算；它只取消当前回复，保持
Single Chat Conversation active，并允许下一条用户消息建立新 Run。它不进入 accepted-input blocker、Native Turn
reconcile、私有 transcript replay 或专用恢复状态。完整边界见 [Single Chat Architecture](single-chat.md#取消结束与并发)。

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

## 4. 调度与 Adapter 边界

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

## 5. 用户与预算收敛

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

## 6. 证据与观测

- `accepted` 回执证明 Runtime 接受过输入，不证明模型读取、工具完成或 terminal result；
- Runtime correlation ID 不自动升级为 Provider Turn ID；
- Execution Evidence、ContextManifest、Git Observation 和 Workspace 现场不因 blocker resolution 删除；
- UI 的“结果待确认”是领域状态投影，不是 Runtime 正在执行恢复动作的动画状态。
