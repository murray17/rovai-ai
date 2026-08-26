---
document_type: architecture
authority: native-session-bootstrap-redelivery
last_updated: 2026-08-25
---

# Native Session Bootstrap Redelivery

本文维护 Native Session context compaction 后 Bootstrap 补发的长期组件边界、Runtime policy、
detector transport 与输入时序。detector 基线实施以 [v0.48](../versions/v0.48/README.md)为准，Kimi
completion-frame 扩展以 [v1.27](../versions/v1.27/README.md)为准；目标 Runtime smoke 见
[Runtime 兼容性清单](../runtime-compatibility.md)。Grok structured completion 扩展以
[v1.28](../versions/v1.28/README.md)为准。当前 Redelivery v2 实施状态以
[v0.50](../versions/v0.50/README.md)为准。
Bootstrap v3 的 Self/Peer identity 边界和当前 Dynamic Context ACK 见
[成员投影不变量](foundational-invariants.md#member-projection)与
[Collaboration State v2](../contracts/collaboration-state-v2.md)。Redelivery Envelope/Formatter v2 和
模型投影/Evidence 分层见
[ContextManifest 与 Run Facts 不变量](foundational-invariants.md#context-manifest-run-facts)。

## 两个独立生命周期

```text
Rovai release / Core process
  └── process-start environment policy snapshot
        └── best-effort detector capability

Conversation
  └── Native Binding generation → one external Native Session
        ├── Observer Lease identities
        └── durable requested / acknowledged redelivery revisions
```

版本 policy 不冻结到 Binding generation；它决定是否尝试观察未来 signal。Requirement 则必须绑定
generation，因为 compaction 只属于一个具体外部 Session。policy 后续 disable 不能清除已持久化
pending。

## 版本 policy

内部环境变量只接受 `disabled | best_effort`，由 Rovai 版本维护，不是客户设置：

| Runtime | Bootstrap class | 当前 policy | 环境变量 |
| --- | --- | --- | --- |
| GitHub Copilot | `signal_driven` | `best_effort` | `ROVAI_INTERNAL_COPILOT_COMPACTION_DETECTOR_POLICY` |
| OpenCode | `signal_driven` | `best_effort` | `ROVAI_INTERNAL_OPENCODE_COMPACTION_DETECTOR_POLICY` |
| Kiro | `signal_driven` | `best_effort` | `ROVAI_INTERNAL_KIRO_COMPACTION_DETECTOR_POLICY` |
| Kimi Code | `signal_driven` | `best_effort` | `ROVAI_INTERNAL_KIMI_COMPACTION_DETECTOR_POLICY` |
| Grok Build | `signal_driven` | `best_effort` | `ROVAI_INTERNAL_GROK_COMPACTION_DETECTOR_POLICY` |
| Qoder | `signal_driven` | `best_effort` | `ROVAI_INTERNAL_QODER_COMPACTION_DETECTOR_POLICY` |
| CodeBuddy | `signal_driven` | `best_effort` | `ROVAI_INTERNAL_CODEBUDDY_COMPACTION_DETECTOR_POLICY` |
| Qwen Code | `signal_driven` | `best_effort` | `ROVAI_INTERNAL_QWEN_COMPACTION_DETECTOR_POLICY` |
| Antigravity | `unavailable_no_qualified_signal` | `disabled` | `ROVAI_INTERNAL_ANTIGRAVITY_COMPACTION_DETECTOR_POLICY`；v0.48 不允许 enable |
| TRAE CLI CN | `not_observed_no_qualified_signal` | `disabled` | 无；`0.120.52` manual/auto ACP 与 Hook Probe 未见结构化完成边界，状态不是 `Unsupported` |
| Claude Code | `protected_instruction_layer` | 不适用 | 无 |
| Codex CLI | `protected_instruction_layer` | 不适用 | 无 |

无效值 fail-safe 为该 detector `disabled`，但不阻止 Core 或 AgentRun。`best_effort` 只表示并行尝试
建立 detector；`establishing | observing | unavailable` 是内部增强状态，不进入 Runtime Readiness、
Member 配置或 AgentRun admission。恢复后只观察未来 signal，不推断 gap，也不切 one-shot Session、
修改用户配置或使用 token heuristic。

首次 `disabled -> best_effort` policy epoch 会为该 Runtime 已有 accepted current Binding 各建立一次
Bootstrap baseline；同一 epoch 重启幂等。尚未接受输入的新 Binding 已由正常首次 Bootstrap 覆盖。
普通 detector reconnect 不产生 baseline。

## Runtime detector 与 admission

| Runtime | 唯一 admission point | detector transport | 选择理由 |
| --- | --- | --- | --- |
| GitHub Copilot | `preCompact` / `imminent_edge` | 隔离官方 Plugin `preCompact` Hook | 目标 CLI 没有对等 completed Hook；该 edge 一次性推进 revision，accepted redelivery 后即结束，不等待 post event |
| OpenCode | `session.compacted` / `completed` | 隔离 native Plugin event；prompt 仍走 ACP | ACP 主消息流不转发 native event，完成事件本身可靠 |
| Kiro | `_kiro.dev/compaction/status` 且 `params.status.type=completed` | 当前 ACP inbound route | 目标版本真实 compact 明确发出 started 后 completed；忽略 started 与 summary |
| Kimi Code | `kimi.acp.compaction.completed_text.v1` / `completed` | Kimi-only Prompt lifecycle correlation + idle/detached completion compatibility route | Kimi native ACP server 把内部 lifecycle 降格为同形 `agent_message_chunk`；Active Prompt 只有 exact started 建立 pending 后的 exact completed 才准入，blocked 保持 pending，cancelled 清除 pending；idle/detached 保留 exact completion detector |
| Grok Build | `grok.acp.auto_compact_completed.v1` / `completed` | 当前 ACP `_x.ai/session_notification` inbound route | `0.2.118` no-leader live wire 是初始历史证据；当前支持门为 `>= 1.0.0`，detector 保持 `best_effort` 且目标版本需分别复核。event ID 作为 Runtime occurrence identity，started/failed/cancelled/replay/unknown 全部忽略 |
| Qoder | `PostCompact` / `completed` | 隔离 `--settings` Hook | 目标版本真实 `/compact` 完成态可靠 |
| CodeBuddy | `SessionStart(source=compact)` / `completed` | 隔离 `--plugin-dir` Plugin Hook | `2.133.1` emergency auto compaction 完成后真实触发；CLI additional settings 未注册 lifecycle Hook。该版本 pre-message compaction 绕过全部相关 Hook，故 detector 仍是有明确 coverage gap 的 `best_effort`，不做 token 推断 |
| Qwen Code | `PostCompact` / `completed` | 私有 `QWEN_HOME` user Hook | 上游 HookRegistry 不读取 system Hook；私有 user settings 保留原配置且不修改用户文件。trigger matcher 为 exact match，使用 `*` 后由 relay 校验 `manual|auto` |
| TRAE CLI CN | none observed | none | `0.120.52` advertised `/compact` 已执行 manual/auto；只有普通 update/assistant 文本，项目/控制 Hook 在 `acp serve` 下未触发；保持 `NotObserved` / `Unverified` |
| Claude Code / Codex / Antigravity | none | none | protected layer 或无合格 event |

Hook relay command 冻结 adapter、Host 与 expected source signal，不信任 payload 自报 source；payload
若携带 event name 必须完全匹配。Copilot 目标版本 payload 不带 event name，因此 command-side source
尤其必要。relay 只持久化 lifecycle metadata 的 digest，不把 compact summary、prompt、Bootstrap 或
identity-derived bytes 写入 observation evidence。

Kimi detector 不安装 Hook、不修改用户 `KIMI_CODE_HOME/config.toml`，也不建立额外 side-channel。官方 started
帧为 `Compacting conversation context…` 或带 instruction 的同一模板；completed 固定为
`Compaction completed.` 及 messages/tokens before/after 三行 en-US 整数，cancelled 与 blocked 也只接受目标
版本的完整固定文本。Prompt 内由 Kimi-only 状态机相关：started 建立 pending；blocked 只说明当前 turn 正在
等待 compaction，保持 pending；completed 产生一次 observation 并清除 pending；cancelled 只清除 pending。
这些已相关的 lifecycle frame 作为 Session metadata 内部消费，不进入 streamed agent text、Runtime final 或
Missing-Send。没有 pending 的 Active Prompt completed 保持普通 assistant output，不产生 observation。

Grok detector 不安装 Hook、不修改 `$GROK_HOME`，只消费目标版本的 structured vendor notification。notification
必须没有 JSON-RPC request ID，method 精确为 `_x.ai/session_notification`，`params.sessionId` 命中 active Lease，
`params.update.sessionUpdate` 精确为 `auto_compact_completed`，`tokens_after` 为非负整数，且
`params._meta.eventId` 为非空字符串；可选 `tokens_before` 必须是非负整数，可选 `elapsed_ms` 必须是非负整数。
`_meta.isReplay=true`、leader nested envelope、started/failed/cancelled、ordinary agent text 与未知字段组合均不
推进 revision。token、耗时和 summary 不进入 observation digest、模型输入或公开 Evidence。

如果 completion 发生在 Grok 当前 Prompt 内部的 compact-and-resubmit，Core 不在通知栈中发送新 prompt。
`_meta.rules` 继续承载该 Session 的 system-level Bootstrap；completion 只推进 Requirement，由下一次尚未
prepared 的 Core-controlled input 使用既有 Redelivery Envelope v2。目标版本的 acceptance-only debug arm 只用于
真实验收，不是产品能力、用户设置或 detector transport。

Prompt 已结束或正常 AgentRun 已 detach、但 observer 仍绑定于同一 warm Host/Session 时，保留既有 exact
completed compatibility route。Kimi ACP wire 没有 lifecycle source tag、occurrence ID 或 message provenance；
因此 Prompt 状态机只能把单帧误判收窄为 exact started→completed 组合，无法在 wire 层证明模型不会逐字生成
同一整套 frame。该残余歧义是 `best_effort` 能力边界，不使用一分钟窗口、token-drop heuristic 或宽泛关键词
补猜；Rovai 沿用 Host instance 内单调 observation sequence 形成本地 occurrence。

Copilot 的一次 `preCompact` 只产生一个 requirement revision。目标版本后台 compaction 会 snapshot
已有历史并保留其间新增消息；真实 smoke 也确认 Hook 后下一 ACP 输入可 accepted。因此 v0.48 选择
pre edge，避免等待不存在的 completed Hook。其余 Runtime 有可靠 completed surface，只认完成态，
不接受 PreCompact、started、failed、cancelled、unknown 或 telemetry。

## Observer Lease 与去重

```text
adapterInstallationId + hostInstanceId + relayProcessId + nativeSessionId
  + nativeBindingId + nativeBindingGeneration + detectorPolicyEpoch
    └── submit exact version-qualified compaction observation only
```

Observer Lease 在 bind 或 verified Resume 后建立，可跨 AgentRun 存续，但不延长 AgentRun lease，也不
授权 prompt、Built-in Tool 或 Camp/Task/Message/Memory mutation。Binding/Host/Session/policy epoch
替换和 Core restart fence 旧 Lease；Resume 同一 Session 到新 Host 使用新 identity。

Runtime-specific signal 最终进入同一 Session-scoped Core command。Core 验证 active Lease、current
Binding route、policy epoch 和 exact admission。source observation 去重键是
`(nativeBindingId, generation, sourceObservationId)`，因此同一 Hook retry 或 Host/Observer 替换后的
replay 最多推进一次 requested revision。

普通 Host、Core 或 relay 中断不是 compaction。relay 在提交前把已接住的具体 signal 写入私有 durable
outbox，只保留 adapter、Host、Session、signal、trigger、digest 与时间，不保留 prompt、summary 或
Bootstrap；Core ACK 后删除。若 submission result unknown，Core restart 或对应 Host exit fencing 前用
同一 observation identity 幂等回放。没有 signal 的 generic exit 不得合成 Requirement。

## Delivery Gate 与 prepared cutoff

`pending_redelivery` 是
`requestedRevision > acknowledgedRevision` 的派生状态。输入路径为：

> 下列 Envelope v2 / Formatter v2 已由 v0.50 实现；实施与验收状态见
> [v0.50 概览](../versions/v0.50/README.md)。

```text
[ROVAI_BOOTSTRAP_REDELIVERY reason="context_compaction"]
This is Core recovery context for the existing Native Session, not a new task or Session.

<complete Native Session Bootstrap>
[/ROVAI_BOOTSTRAP_REDELIVERY]

<immutable AgentRun Dynamic Context>
```

该目标模型可见格式是 Redelivery Envelope v2 / Formatter v2。v1 的三句 Runtime 生命周期说明不再进入
模型文本；上面这一句 recovery authority 不可省略。v1 已经是持久化到 Runtime Input Delivery 的
v0.48 合同，因此 marker schema 与 wording 改变必须形成新版本，而不能原地复用 v1 identity。

Core 使用同一个数据库 mutex 串行化：

1. revalidate Run 与 Binding generation；
2. materialize dynamic-only ContextManifest 并选择当前 pending revision；
3. 复用现有 Bootstrap assembler 生成 transient overlay；
4. 持久化带 selected revision 的 `RuntimeInputDelivery.prepared`；
5. mutex 释放后才允许 transport 得到 payload。

第 2 与第 4 步目前分别提交 SQLite transaction，但处于同一 Core mutex 临界区。中间 Manifest 是
unsendable staging state；Observer 无法在其间提交，crash recovery 会复用 Manifest 并重新读取当前
pending 后才能创建 Delivery。因而逻辑 cutoff 是 Delivery `prepared`，并不存在可送出而未经过
redelivery selection 的 payload。prepared 后提交的 observation 留给下一输入，不能修改冻结 bytes。

补发组装在每次 eligible redelivery 时读取最新完整六字段 `MEMBER_IDENTITY`，但不把这些字段写入
ContextManifest、Delivery digest 或 Collaboration State。`MEMBER_IDENTITY` 始终是 Session 唯一
self identity；Dynamic Context 的 Collaboration State v2 只含 peers。身份编辑本身不创建
Requirement、Input、Run 或新 Session，也不改变这里的 eligible delivery matrix。

同一 Runtime Input Delivery 可以同时冻结 Bootstrap redelivery revision 和完整
`collaboration_state_digest`，但两条水位相互独立：前者消费该 Delivery 选择的 Requirement revision，
后者推进到 ContextManifest 的完整 Collaboration State v2 projection digest；
`collaborationStateIncluded` 只说明本轮是否渲染 peer section。只有同一个 accepted ACK 才能分别推进
这两条冻结水位，send failure、`delivery_unknown`、process loss 和未 accepted 输入对两者都不推进。

完整 Bootstrap 与 Current Input 不可截断。combined payload 超限时只按现有 Context Delivery Profile
确定性削减 optional Dynamic Context；仍超限则在 prepared 前 fail closed。ContextManifest 仅存实际
Dynamic Context 与 omission evidence。Delivery 仅存 selected revision、Bootstrap Evidence ID、
presence 和 envelope/formatter version；不存完整 overlay、Member Identity snapshot 或含 Identity
digest。

只有 selected Delivery 获得 Runtime accepted ACK，才将 acknowledged revision 推进到该冻结值。
send failure、`delivery_unknown` 和 process loss 不消费 Requirement；ACK 较旧 revision 也不能清除
Gate 后到达的更高 requested revision。

## 长期约束

- [Session 与 Bootstrap 不变量](foundational-invariants.md#context-session-bootstrap)：durable revision 与 ACK；
- [Session 与 Bootstrap 不变量](foundational-invariants.md#context-session-bootstrap)：版本 policy 与首次启用；
- [Session 与 Bootstrap 不变量](foundational-invariants.md#context-session-bootstrap)：exact signal 与 cutoff；
- [Session 与 Bootstrap 不变量](foundational-invariants.md#context-session-bootstrap)：transient overlay、budget 与 privacy；
- [Session 与 Bootstrap 不变量](foundational-invariants.md#context-session-bootstrap)：Observer authority 与中断；
- [Session 与 Bootstrap 不变量](foundational-invariants.md#context-session-bootstrap)：non-blocking detector。
- [ContextManifest 与 Run Facts 不变量](foundational-invariants.md#context-manifest-run-facts)：Redelivery
  v2 marker/wording 与模型投影、Manifest、Delivery Evidence 分层。
