---
document_type: version-decisions
version: v0.71
lifecycle: historical
last_updated: 2026-08-18
---

# v0.71 决策记录

本文件按来源版本聚合迁移前的数字 ADR，保存当时的背景、选择、后果与被拒绝方案。它是历史理由来源，不是当前系统规范真源；当前规范从 [文档导航](../../README.md) 进入。

## 历史 ADR 索引

| 历史 ID | 决策 | 迁移时状态 |
| --- | --- | --- |
| [ADR-0175](#adr-0175) | Core-Owned Notification Occurrence, Episode and Change Journal | `accepted` |
| [ADR-0176](#adr-0176) | Eleven-Skill Official Inventory and System-Required Operations | `superseded` |
| [ADR-0177](#adr-0177) | Controlled Shutdown Fences Product Execution Without Claiming Runtime Outcome | `accepted` |

<!-- legacy-adr:begin id=ADR-0175 source-file-sha256=a35f778588b4ab8bd0c4b456f64727dbda5e3e56bbde9eeeccd52770cbc0e724 -->
<a id="adr-0175"></a>

## ADR-0175: Core-Owned Notification Occurrence, Episode and Change Journal

迁移时原路径：`docs/adr/0175-core-owned-notification-occurrence-episode-and-change-journal.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0175
title: Core-Owned Notification Occurrence, Episode and Change Journal
status: accepted
date: 2026-08-13
decision_scope: cross-version
source_version: v0.71
supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0175 -->
<a id="adr-0175-context"></a>
### Context

ADR-0087 的一来源一行 Inbox 能持久化通知，却无法在不丢失每条 Mention 精确确认的前提下，把同一
CampTurn 的 Mention 与终态表达成一件用户事项；只轮询新建行也看不到 Episode 升级、解决或清除后
重新出现。Renderer 聚合会复制领域规则，并让迟到的 read/clear 吞掉并发更新。

<a id="adr-0175-decision"></a>
### Decision

Core 以三层通知模型替代旧 Inbox row：不可变 NotificationOccurrence 记录每个合格来源事实；独立
Disposition 记录 acknowledge/satisfy/resolve；materialized NotificationEpisode 按 CampTurn、无 Turn
消息或 Approval generation 聚合成一张卡片；最小 NotificationChangeJournal 为增量和 heads-up 提供
全局单调边界。来源事实、Occurrence、Episode upsert 与 Journal append 在同一 SQLite 事务提交。

Episode 的 `episodeVersion` 与 `attentionRevision` 分离。前者覆盖所有持久语义变化，后者只覆盖新注意
事项；clear through attention revision，因此 Camp 改名、availability、acknowledge 或 resolve 不会复活
已清除事项。所有 acknowledge、clear 和 mark-all 写入都绑定用户观察边界。

Core Read Side 拥有 closed display semantics、原因计数和状态、排序、当前最早未确认 Mention、类型化
主/次 action 及各自 availability。Renderer 只拥有本地化、布局和动作执行，不按 Camp 或时间重新聚合，
也不从标题推断 locator。普通 Agent 公屏消息继续只在 Camp 时间线，不形成通知。

本决定细化 ADR-0087 和 ADR-0165；两者关于 SQLite 真源、来源事务、Current User identity、Structured
Content 和 Agent routing/User attention 正交性的其余条款保持有效。v2 的 per-message Inbox row 由
Current User Attention v3 替代，不原地修改 ADR-0165。

<a id="adr-0175-consequences"></a>
### Consequences

- 同一 Episode 可以升级且仍逐条确认 Mention；迟到命令不能吞掉新 revision。
- Renderer reload 从 Inbox high-water 开始，不补弹历史；运行中更新由 Journal 精确驱动。
- Core Schema、JSON-RPC、TypeScript、Renderer 和设置必须一次 clean break，旧通知数据与偏好不迁移。
- Journal 需要 floor/reset/retention；可重新出现 Episode 不再适用 clear 一天后删除。

<a id="adr-0175-rejected-alternatives"></a>
### Rejected Alternatives

- **Renderer 聚合旧行。** 会复制优先级、确认和并发语义，多个窗口无法共享真源。
- **Episode 一个 readAt。** 会让新 Mention 或部分确认吞掉同 Episode 的其他来源。
- **Journal 保存完整 read view。** 会复制可变标题、正文和 availability，并形成第二份历史真源。
- **用 episodeVersion 清除。** 非注意力呈现变化会错误复活已清除事项。
- **迁移未上线旧数据。** 扩大双读/回填代码而没有用户价值；v0.71 采用通知域 clean break。

<a id="adr-0175-references"></a>
### References

- [Notification Episode v4](../../contracts/notification-episode-v4.md)
- [Current User Attention v4](../../contracts/current-user-attention-v4.md)
- [ADR-0087](../v0.28/decisions.md#adr-0087)
- [ADR-0165](../v0.65/decisions.md#adr-0165)
<!-- legacy-adr-body:end id=ADR-0175 -->
<!-- legacy-adr:end id=ADR-0175 -->

<!-- legacy-adr:begin id=ADR-0176 source-file-sha256=bd5f5404139c0798277ca1dcce9e9b797fb3ce42646af8e7ea6e6adf164a8bc0 -->
<a id="adr-0176"></a>

## ADR-0176: Eleven-Skill Official Inventory and System-Required Operations

迁移时原路径：`docs/adr/0176-eleven-skill-official-inventory-and-system-required-operations.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0176
title: Eleven-Skill Official Inventory and System-Required Operations
status: superseded
date: 2026-08-13
decision_scope: cross-version
source_version: v0.71
supersedes:
  - ADR-0174
superseded_by: ADR-0181
```

<!-- legacy-adr-body:begin id=ADR-0176 -->
<a id="adr-0176-context"></a>
### Context

ADR-0174 freezes ten official Skills and treats all of them as ordinary user-configurable Library
entries. Rovai now needs one project-native Camp collaboration workflow: a Default Lead invites a
small set of members to form independent opening views, directs only the exchanges that can change
the conclusion, and publishes one terminal summary.

Two existing Skills also carry product-wide operational responsibilities rather than optional user
workflows. `cli-operations` teaches safe use of the built-in CLI, while `memory-stewardship`
preserves Memory authority and mutation boundaries. Allowing either to be disabled or removed from
a Runtime Group can silently remove required guidance; presenting them as ordinary Settings rows
also suggests that such a configuration is supported.

<a id="adr-0176-decision"></a>
### Decision

1. Rovai releases exactly eleven official Skills: `analyze-agent-codebase`, `campfire`,
   `cli-operations`, `diagnosing-bugs`, `grill-duo`, `grill-duo-with-docs`,
   `memory-stewardship`, `tasteful-ui`, `tdd`, `worktree`, and `writing-for-agents`.
2. `campfire` is original Rovai work with six bundled files and no external upstream. Its
   Skill-only v1 uses ordinary public Camp Messages and trusted Runtime-provided sender identity;
   it introduces no new message kind, persisted discussion object, or Core orchestration state.
3. Campfire is bounded to 2–3 participants, independent opening views, zero to two directed
   responses, and at most one clarification initiated by Campfire. One Default Lead actively
   advances at most one unfinished Campfire per Camp. A shared invitation is the default, including
   when it contains a per-member perspective assignment.
4. The natural headings for invitation, opening view, directed response, and clarification may
   continue a discussion. `### 篝火纪要` is the terminal marker and never a trigger. A completed
   discussion is not reopened by a late reply; publishing the summary does not create a Task, write
   Memory or an ADR, approve implementation, or start implementation.
5. `cli-operations` and `memory-stewardship` have the `system_required` management policy. Core keeps
   both enabled and assigned to all nine Runtime Groups, rejects enablement or Assignment mutation
   commands for them, and repairs legacy configuration drift during bundled installation. They are
   omitted from the Renderer Skill Settings list and have no toggle, Assignment, or locked-state row
   there; they remain official Runtime-delivered Skills and remain available to native discovery.
6. The other nine official Skills, including `campfire`, retain the `user_managed` policy: they are
   enabled and assigned to all Runtime Groups when first installed, then may be configured through
   the ordinary Skill Library controls.
7. ADR-0174's pinned GitHub provenance, exact vendored manifests, offline installation, narrowed
   trigger descriptions, `tasteful-ui` snapshot, collision protection, and authority limits remain
   in force. A Skill never grants authority beyond the current request and Runtime permissions.
8. Any future official inventory or management-policy change requires another successor ADR plus
   coordinated Core contract, bundled source, Renderer, documentation, smoke, and acceptance
   updates.

This decision completely supersedes ADR-0174. ADR-0158 continues to own default-all delivery for
newly installed user-managed Skills; this decision strengthens that policy into a continuously
enforced invariant only for the two system-required Skills. ADR-0166 continues to own progressive
CLI teaching.

<a id="adr-0176-consequences"></a>
### Consequences

- Core and native Runtime discovery contain eleven official Skills, while Settings intentionally
  presents nine configurable official Skills.
- Required CLI and Memory guidance cannot disappear through supported configuration commands, and
  startup repairs unsupported legacy drift without adding a database column.
- Campfire can ship and evolve as inspectable Skill content without coupling its phases to a new
  Core protocol or pretending that public messages provide strict blind review.
- Natural public headings stay understandable to users and avoid leaking internal protocol tags;
  the terminal summary cannot accidentally re-trigger the workflow.
- Existing pinned GitHub Skills remain reproducible and offline.

<a id="adr-0176-rejected-alternatives"></a>
### Rejected Alternatives

- **Hide the two operational Skills only in Renderer.** Rejected because older clients, direct
  commands, or existing database drift could still disable required delivery.
- **Show disabled controls or a required badge.** Rejected because the Settings surface is for
  supported choices; a non-choice row adds noise and implies a configuration path that does not
  exist.
- **Make every official Skill system-required.** Rejected because the remaining Skills are optional
  user workflows whose enablement and Runtime delivery are legitimate preferences.
- **Add Campfire message kinds or a persisted discussion state machine.** Rejected for v1 because
  bounded public A2A Messages and Skill instructions already express the workflow; Core state can be
  reconsidered only if observed failures require it.
- **Use bracketed phase tags or `$campfire` in public bodies.** Rejected because natural headings are
  sufficient for participants and do not expose invocation mechanics in the conversation.

<a id="adr-0176-references"></a>
### References

- [v0.71 current version](README.md)
- [ADR-0158: Default-All Runtime Delivery for Managed Skills](../v0.58/decisions.md#adr-0158)
- [ADR-0166: Progressive Built-In CLI Teaching](../v0.65/decisions.md#adr-0166)
- [ADR-0174: Ten-Skill Official Inventory (historical)](../v0.70/decisions.md#adr-0174)
- [`campfire` bundled source](../../../skills/campfire/SKILL.md)
- [Built-in Tool Runtime](../../architecture/builtin-tool-runtime.md)
- [Skill Projection Reconciliation](../../architecture/skill-projection-reconciliation.md)
<!-- legacy-adr-body:end id=ADR-0176 -->
<!-- legacy-adr:end id=ADR-0176 -->

<!-- legacy-adr:begin id=ADR-0177 source-file-sha256=0896556af95987b1e87c464ae918e77e4dc73d4a86ef325a0a74d8ef2391fd4f -->
<a id="adr-0177"></a>

## ADR-0177: Controlled Shutdown Fences Product Execution Without Claiming Runtime Outcome

迁移时原路径：`docs/adr/0177-controlled-shutdown-fences-product-execution.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0177
title: Controlled Shutdown Fences Product Execution Without Claiming Runtime Outcome
status: accepted
date: 2026-08-13
decision_scope: cross-version
source_version: v0.71
supersedes: []
intended_supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0177 -->
<a id="adr-0177-context"></a>
### Context

ADR-0168 preserved Runtime terminal authority during an intentional quit, restart or update. When an Adapter could
not report a reliable terminal before the deadline, the AgentRun remained non-terminal and became an accepted-input
or delivery-unknown recovery blocker after restart. This avoided inventing a Runtime outcome, but it left Rovai's own
execution lifecycle open even though the user had explicitly closed the application and the old Core generation could
never execute that Run again.

ADR-0062 already separates Rovai execution authority from external-effect certainty. A controlled shutdown can
durably revoke the former without claiming the latter, provided the shutdown intent and fence survive interruption and
the original input is never replayed.

<a id="adr-0177-decision"></a>
### Decision

1. A valid Main-only controlled-shutdown request first persists a durable shutdown cycle, then closes launch admission.
   The cycle is the authority to finish fencing every AgentRun that remains non-terminal at its settlement boundary.
2. The live Core generation still gives matching Runtime terminal observations priority during its bounded drain.
   Reliable success, failure or cancellation retains the existing `runtime_terminal` provenance.
3. After terminal and live-route admission closes, Core must also stop or fence every tracked execution writer,
   including AgentRun tasks and Built-in Tool invocations. It then product-fences every remaining non-terminal AgentRun
   into `cancelled`. This terminal means Rovai has permanently revoked that execution's write and scheduling authority;
   it does not mean the Provider proved that its Native Turn was cancelled. The settlement does not create a CampTurn
   user cancellation intent and does not write Runtime-terminal provenance. If writer quiescence cannot be proved in
   the bounded window, Core leaves the durable cycle pending for next-start compensation instead of publishing an
   unsafe terminal.
4. Runtime Input Delivery and external-effect evidence remain independent. `accepted` and `delivery_unknown` are
   preserved. A `prepared` input at this boundary becomes `delivery_unknown`, because prompt handoff may already have
   occurred without a durable ACK. Unknown dispatched Actions remain reconcilable. The read model must continue to show
   unsettled external effects on the terminal Run and must never retry the original input automatically.
5. If Core or Desktop exits after the cycle is persisted but before settlement commits, the next Core generation
   settles every pending cycle before ordinary startup recovery. Once a cycle is settled, recovery is idempotent and
   cannot restore execution authority to its cancelled Runs.
6. A crash, force-kill or power loss before a controlled-shutdown cycle is durably recorded remains ordinary crash
   recovery. This decision does not claim generic cross-process Native Turn reconciliation.

This decision locally replaces ADR-0168's rule that every accepted input lacking a reliable shutdown terminal must
remain a non-terminal startup blocker. It also narrows ADR-0164 only for AgentRuns covered by a durable controlled-
shutdown cycle; ordinary crash recovery remains unchanged.

<a id="adr-0177-consequences"></a>
### Consequences

- Closing Rovai no longer leaves a planned-shutdown AgentRun indefinitely displayed as active or waiting.
- Users can reopen the application and see a terminal Run while still receiving an explicit warning when files,
  commands, tools or other external effects may be unresolved.
- Core owns a durable shutdown-cycle ledger, an idempotent product-fence settlement and a startup compensation step.
- The shutdown report distinguishes reliable Runtime terminal settlement from product-fenced terminal settlement.
- A controlled shutdown may fail a CampTurn whose required Run was product-fenced, while optional fenced Runs do not
  prevent completion. `CampTurn.cancelled` still requires an explicit user cancellation intent.
- Cross-process automatic continuation of an in-flight Native Turn remains unavailable unless an Adapter separately
  proves the reconciliation capability required by ADR-0164.

<a id="adr-0177-rejected-alternatives"></a>
### Rejected Alternatives

- **Keep recovery blockers after every controlled shutdown.** This preserves uncertainty by leaving product execution
  authority open, even though the old generation can never use it again.
- **Label process exit or interrupt acknowledgement as a Runtime cancellation.** Neither observation proves the Native
  Turn outcome and both would forge `runtime_terminal` provenance.
- **Rewrite uncertain input as not accepted.** Prompt bytes may have crossed the handoff boundary before ACK loss, so
  this could authorize a duplicate retry.
- **Automatically resend or resume the Run after restart.** Current Session resume does not reattach the same Native
  Turn and may duplicate model work, tools and external effects.
- **Reuse CampTurn Stop.** Application shutdown is not a user decision to cancel the whole CampTurn tree, and writing
  that intent would change sibling and aggregate semantics.
- **Wait indefinitely for Provider confirmation.** A hung Runtime would retain authority over whether Rovai can exit.

<a id="adr-0177-references"></a>
### References

- [v0.71 current version](README.md)
- [ADR-0062: Interruptible Runs and Unsettled External Effects](../v0.17/decisions.md#adr-0062)
- [ADR-0164: Accepted Input Recovery Requires Proven Native Turn Reconciliation](../v0.64/decisions.md#adr-0164)
- [ADR-0168: Planned Shutdown Preserves Runtime Terminal Authority](../v0.66/decisions.md#adr-0168)
- [Planned Shutdown v2](../../contracts/planned-shutdown-v2.md)
- [Planned Shutdown architecture](../../architecture/planned-shutdown.md)
<!-- legacy-adr-body:end id=ADR-0177 -->
<!-- legacy-adr:end id=ADR-0177 -->
