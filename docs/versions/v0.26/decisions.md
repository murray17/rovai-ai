---
document_type: version-decisions
version: v0.26
lifecycle: historical
last_updated: 2026-08-18
---

# v0.26 决策记录

本文件按来源版本聚合迁移前的数字 ADR，保存当时的背景、选择、后果与被拒绝方案。它是历史理由来源，不是当前系统规范真源；当前规范从 [文档导航](../../README.md) 进入。

## 历史 ADR 索引

| 历史 ID | 决策 | 迁移时状态 |
| --- | --- | --- |
| [ADR-0082](#adr-0082) | Member-Owned Runtime Parameters and Explicit Configuration | `superseded` |
| [ADR-0083](#adr-0083) | Background Runtime Checks and Actionable User Status | `accepted` |
| [ADR-0084](#adr-0084) | Conversation Surface Controls and Stop Outcome Projection | `accepted` |

<!-- legacy-adr:begin id=ADR-0082 source-file-sha256=acb2f9cccfd944e4ceea3036194e4c988a4fad27f8f167229574b44d53e0bfaf -->
<a id="adr-0082"></a>

## ADR-0082: Member-Owned Runtime Parameters and Explicit Configuration

迁移时原路径：`docs/adr/0082-member-owned-runtime-parameters.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0082
title: "Member-Owned Runtime Parameters and Explicit Configuration"
status: superseded
date: 2026-07-31
decision_scope: cross-version
source_version: v0.26
supersedes: []
superseded_by: ADR-0127
```

<!-- legacy-adr-body:begin id=ADR-0082 -->
> 后续 [ADR-0123](../v0.41/decisions.md#adr-0123) 在 Native Session compatibility
> 之外增加独立的物理进程复用身份：Adapter 必须让所有进程级输入参与 opaque
> `runtime_compatibility_digest`，配置变化同时驱动 IdleWarm 失效或 Busy 进程
> retire-after-run。本文的成员配置所有权、逐 AgentRun 冻结和 drift fail-closed 条款继续有效。

<a id="adr-0082-context"></a>
### Context

ADR-0066 simplified ordinary member setup to a Product Runtime Selection. The member saved only an
`AdapterKind`; after a managed Installation became ready, Core silently materialized the Runtime
default model and Rovai-reviewed conservative permission defaults. This kept executable discovery
out of the member page, but removed member-level control over model selection, model options,
sandboxing, approvals and other Runtime-native permission modes.

The supported Product Runtimes expose materially different concepts and values. Treating all of
them as one generic permission level would discard native meaning, while allowing Renderer to pass
arbitrary capability fields would make the UI a configuration authority. Runtime configuration
also participates in Native Session compatibility and must remain frozen per AgentRun.

<a id="adr-0082-decision"></a>
### Decision

<a id="adr-0082-member-runtime-configuration-is-one-atomic-preference"></a>
#### Member Runtime Configuration is one atomic preference

A resolved member configuration consists of:

```json
{
  "adapterKind": "codex-cli",
  "model": {
    "mode": "explicit",
    "modelId": "gpt-5",
    "options": {
      "reasoning_effort": "high"
    }
  },
  "permissions": {
    "adapterKind": "codex-cli",
    "schemaVersion": 1,
    "values": {
      "sandbox_mode": "danger-full-access",
      "approval_policy": "never"
    }
  }
}
```

Product Runtime, model policy and Adapter Permission Configuration are edited as one draft and
saved by one version-checked command. Switching Product Runtime only replaces the local draft until
save succeeds. A successful save replaces all old Runtime-specific values; fields are never
translated or retained across Runtimes.

Ordinary configuration continues to resolve the shared Managed Default Installation internally.
Installation ID, executable path, fingerprint, auth scope, discovery and migration evidence remain
absent from the editable command and member UI.

<a id="adr-0082-unresolved-selection-is-the-only-partial-state"></a>
#### Unresolved selection is the only partial state

If no ready managed Installation and capability snapshot exists, a user may save only the
`AdapterKind`. The member remains `selected_unresolved` and cannot create a new AgentRun. Later
discovery or probing never silently materializes model or permission values. Once the Runtime is
ready, the user must explicitly save a complete Member Runtime Configuration.

When a ready snapshot exists, model and permissions must either both validate and commit or neither
may change. Core validates the complete configuration against the current snapshot inside the save
transaction.

<a id="adr-0082-model-policy-has-two-precise-modes"></a>
#### Model policy has two precise modes

`runtime_default` follows both the Runtime's current default model and that model's default options.
It persists no `modelId` and no model options.

`explicit` persists one model ID and only options reported for that model by the current capability
snapshot. Model-specific controls are unavailable in `runtime_default` mode. Unknown models,
unknown options and invalid values are rejected.

<a id="adr-0082-runtime-native-permissions-and-explicit-member-defaults"></a>
#### Runtime-native permissions and explicit member defaults

Each Product Runtime owns a dedicated parameter component and Core mapping. Renderer owns layout,
labels and control shape for recognized fields; Core Adapter policy owns native field names,
values, member defaults and schema version. Models and model-option values come from the latest
Adapter Capability Snapshot. Unknown fields are neither rendered nor passed through.

When the user explicitly saves a ready Runtime without changing its initial draft, Core may write
the following least-restrictive member defaults:

| Runtime | Permission defaults |
|---|---|
| Codex CLI | `sandbox_mode=danger-full-access`, `approval_policy=never` |
| OpenCode | `permission=allow` |
| GitHub Copilot CLI | `allow_all=on` |
| Claude Code | `permission_mode=bypassPermissions` |
| Kiro CLI | no persisted permission field |
| Qoder CLI | `permission_mode=bypass_permissions` |
| CodeBuddy | `permission_mode=bypassPermissions` |
| Qwen Code | `approval_mode=yolo` |
| Antigravity | `mode=accept-edits`, `sandbox=off`, `dangerously_skip_permissions=on` |

These defaults are ordinary values in the member editor. The UI adds no danger label, warning
color or second confirmation. Core never infers a default from enum order or labels and still
rejects a configured value absent from the current native descriptor.

This replaces ADR-0066's requirement that automatic member resolution materialize only
Rovai-reviewed conservative defaults and never enable bypass/yolo/allow-all values. The replacement
applies only to an explicit member save; background discovery, refresh and migration never expand
permissions.

<a id="adr-0082-drift-blocks-new-runs-without-rewriting-configuration"></a>
#### Drift blocks new Runs without rewriting configuration

If a later capability snapshot no longer supports a saved fixed model, option, permission value or
schema version, Runtime Readiness becomes `needs_attention` and new AgentRuns are blocked. Core does
not reset the member to Runtime defaults or replace permissions. The user must correct and
atomically save the configuration.

Each AgentRun freezes the member configuration at creation. Profile edits and capability drift do
not rewrite already frozen Runs. Host/Session-scoped differences participate in ADR-0007's binding
compatibility digest and cause lazy Native Session replacement before the next incompatible Run;
pure Run-scoped changes do not.

<a id="adr-0082-v026-is-a-clean-member-configuration-reset"></a>
#### v0.26 is a clean member-configuration reset

The project remains pre-release. v0.26 deletes every existing member Product Runtime Selection and
member model/permission preference instead of preserving or translating configurations created by
the adapterKind-only workflow. Shared Installations, capability snapshots, historical frozen
AgentRuns and diagnostic evidence remain intact. Every member must explicitly select and save a
Runtime again.

<a id="adr-0082-consequences"></a>
### Consequences

- Members regain model and Runtime-native execution control without seeing Installation details.
- Runtime-specific components and mappings add deliberate code, test and review cost, but avoid a
  misleading cross-Runtime abstraction.
- Least-restrictive defaults reduce approval interruptions and can authorize broad side effects;
  this is an explicit product choice made at member save rather than a background mutation.
- Snapshot changes fail closed for new Runs and may require user repair.
- Existing member Runtime choices are intentionally lost once at v0.26 upgrade.
- Native Session rollover remains lazy and preserves Rovai-owned portable Conversation context.

<a id="adr-0082-rejected-alternatives"></a>
### Rejected Alternatives

- Keep adapterKind-only member configuration and Core-selected conservative defaults.
- Use one universal “permission level” or generic arbitrary-key form for all Runtimes.
- Persist model options while following the Runtime default model.
- Silently repair invalid values after Runtime upgrade.
- Materialize broad permission defaults when background discovery completes.
- Preserve, translate or automatically broaden pre-v0.26 member configurations.
- Expose Installation ID, executable path or fingerprint in the ordinary member editor.

<a id="adr-0082-references"></a>
### References

- [ADR-0007: Portable Conversation Handoff](../v0.03/decisions.md#adr-0007)
- [ADR-0059: Runtime-Owned Resource Permissions](../v0.16/decisions.md#adr-0059)
- [ADR-0066: Managed Product Runtime Resolution](../v0.20/decisions.md#adr-0066)
- [v0.26 Member Runtime Parameters](README.md)
<!-- legacy-adr-body:end id=ADR-0082 -->
<!-- legacy-adr:end id=ADR-0082 -->

<!-- legacy-adr:begin id=ADR-0083 source-file-sha256=aea6394fcdea35a95145124976cebf65a9cc85fc661c3cb95809d5a8fdf2059c -->
<a id="adr-0083"></a>

## ADR-0083: Background Runtime Checks and Actionable User Status

迁移时原路径：`docs/adr/0083-background-runtime-checks-and-actionable-status.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0083
title: Background Runtime Checks and Actionable User Status
status: accepted
date: 2026-07-31
decision_scope: cross-version
source_version: v0.26
supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0083 -->
<a id="adr-0083-context"></a>
### Context

Runtime Discovery、版本读取、认证与能力探测、可执行文件完整性检查和成员配置校验是不同
成本、不同权威的内部阶段。把“已找到”“尚未检查”“已检查”等阶段直接展示给用户，不能
回答 Agent 运行时是否可用，也不能说明用户下一步应做什么。

如果成员配置页面在打开、切换或保存时同步执行完整探测，CLI 启动、登录状态读取、模型
目录和 fingerprint 计算还会阻塞普通表单交互。另一方面，完全依赖用户手动检查会让缓存
在 Core 长时间运行期间过期，并推迟发现安装、更新和文件身份变化。

本决策局部替代 ADR-0066 第 3、5、7、9 节中“未登记候选默认不深度探测”、成员选择后
同步解析及用户界面展示发现/探测阶段的条款。ADR-0066 的产品目录、Search Environment、
Managed Default Installation、验证后迁移和 Native Session 兼容边界继续有效。
ADR-0075、ADR-0076 的消息优先与执行前轻量完整性确认继续有效。

<a id="adr-0083-decision"></a>
### Decision

<a id="adr-0083-core-统一拥有发现检查和缓存"></a>
#### Core 统一拥有发现、检查和缓存

Core 保留完整的 Runtime Discovery、Probe Attempt、Capability Snapshot、Readiness 和
退避状态机。Renderer 不建立第二份检查状态，也不从路径、版本或错误文本自行判断能否
执行。

最近一次成功 Capability Snapshot 和 Probe Attempt 继续持久化。时间到期但文件身份
未硬失效的成功快照在后台刷新期间仍可使用；失败尝试不得覆盖最近成功证据。路径、
fingerprint、认证、协议或必要能力硬失效时不得继续把旧快照投影为可用。

<a id="adr-0083-完整检查只在后台调度"></a>
#### 完整检查只在后台调度

Core 使用按 Product Runtime 去重的后台调度器，在以下边界排队检查：

- Core ready 后的初始发现完成；
- 后续 Runtime Discovery 或显式重新扫描完成；
- Runtime 安装、更新、受管迁移或已登记启动入口变化；
- 执行边界发现路径或轻量文件身份变化；
- 用户在成员配置中切换 Product Runtime；
- 已登记 Runtime 的最近成功检查超过 24 小时且不在退避期；
- 用户显式请求检查。

检查任务不进入交互请求串行队列，不持有 Renderer 草稿，也不改变已经冻结的 AgentRun。
同一 Runtime 的重复触发合并为一项在途工作。

<a id="adr-0083-页面读取缓存并按需触发刷新"></a>
#### 页面读取缓存并按需触发刷新

成员配置页和 Agent 运行时设置页打开时立即读取最近缓存。所选 Runtime 或目录项缺少结果、
结果过期或已硬失效时，Renderer 只发送轻量 `ensure` 信号；Core 决定是否排队检查并通过
事件发布结果。页面不等待检查即可编辑身份、模型、权限和其他参数。

切换 Product Runtime 会立即替换本地草稿并请求一次后台检查。保存成员配置只在 SQLite
事务中使用当前缓存 Snapshot 校验 Product Runtime、模型和原生权限；不得同步执行
Discovery、CLI 深度探测或完整 fingerprint。缓存不足时仍沿用 ADR-0082 的
`AdapterKind`-only unresolved 保存例外。

AgentRun 启动前继续只做 ADR-0075、ADR-0076 定义的轻量文件身份和持久状态确认；只有
轻量身份变化或证据缺失时才在调度边界计算完整 fingerprint。

<a id="adr-0083-用户状态只表达结果和动作"></a>
#### 用户状态只表达结果和动作

Renderer 只使用以下主状态：

- `正在检查…`
- `可用`
- `需要登录`
- `未安装`
- `版本不支持`
- `不可用`
- `暂时无法确认`

未选择 Product Runtime 时显示“未配置 Agent 运行时”。`found_uninspected`、`checking`、
Discovery 状态、Probe Attempt 状态和 Snapshot 生命周期仍可作为 Core/诊断数据，但
普通 UI 不得展示“已找到”“尚未检查”“已找到，尚未检查”或“已检查”。

主状态每次只显示一个。具体版本、最近刷新失败、配置失效原因和修复入口作为次级说明
展示。存在仍可用的最近成功快照时，后台刷新不能把主状态从“可用”降为“正在检查”。

<a id="adr-0083-consequences"></a>
### Consequences

- 页面打开、Runtime 切换和保存不再等待 CLI 深度探测。
- 用户看到的是可执行结果和修复动作，而不是 Core 内部阶段。
- Core 需要维护后台队列、去重、事件刷新、周期过期检查和安全退出。
- 初始发现后可能并行启动多个已找到 Runtime 的隔离探测，但不会阻塞 Core ready 或普通
  IPC；Adapter 仍必须保持有界超时、无 TTY、私有工作目录和完整进程树终止。
- 最近成功缓存提高可用性，但 Renderer 必须明确展示刷新失败的次级说明，不能声称新
  检查已经成功。

<a id="adr-0083-rejected-alternatives"></a>
### Rejected Alternatives

- **只替换 Renderer 文案。** Core 仍会在保存或页面交互中同步探测，不能解决阻塞。
- **删除内部发现与检查阶段。** 会丢失诊断、退避、迁移和恢复所需证据。
- **没有缓存时显示“已找到”。** 仍不能说明是否可执行或下一步操作。
- **后台刷新时统一显示“正在检查”。** 会隐藏仍可用的最近成功证据并制造无谓停机感。
- **保存前始终重新完整检查。** 把外部 CLI 与文件 I/O 重新放回表单提交热路径。
- **执行前重新深度探测。** 会把模型目录、认证握手和 Session 创建成本放入每次启动，
  也重复 ADR-0075 已移除的高成本检查。

<a id="adr-0083-references"></a>
### References

- [v0.26 Member Runtime Parameters](README.md)
- [ADR-0066: Managed Product Runtime Discovery](../v0.20/decisions.md#adr-0066)
- [ADR-0075: Runtime Integrity at Change and Execution Boundaries](../v0.24/decisions.md#adr-0075)
- [ADR-0076: Message-First AgentRun Dispatch Boundary](../v0.24/decisions.md#adr-0076)
- [ADR-0082: Member-Owned Runtime Parameters](decisions.md#adr-0082)
<!-- legacy-adr-body:end id=ADR-0083 -->
<!-- legacy-adr:end id=ADR-0083 -->

<!-- legacy-adr:begin id=ADR-0084 source-file-sha256=919fb1b4e12601af79cfc9ef050207af282bba81bc89cabc29b011e10f82c218 -->
<a id="adr-0084"></a>

## ADR-0084: Conversation Surface Controls and Stop Outcome Projection

迁移时原路径：`docs/adr/0084-conversation-surface-controls-and-stop-outcome-projection.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0084
title: "Conversation Surface Controls and Stop Outcome Projection"
status: accepted
date: 2026-07-31
decision_scope: cross-version
source_version: v0.26
supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0084 -->
<a id="adr-0084-context"></a>
### Context

The Arctic Dawn Camp surface kept the five-tab Inspector permanently visible and rendered
terminal cancellation beside individual AgentRun content. This preserved access to evidence, but
left less room for the conversation at the minimum supported window width and made a user-issued
Stop look like a member-authored message status.

The accepted cancellation boundary already persists `CampTurn.cancelRequestedAt`, fences every
affected AgentRun, exposes terminal Turn state and records `camp_turn.cancel_requested` in the
domain event log. Renderer therefore has enough authoritative information to present one durable
Stop outcome without creating a synthetic CampMessage or another cancellation state machine.

<a id="adr-0084-decision"></a>
### Decision

<a id="adr-0084-inspector-visibility-is-a-local-presentation-preference"></a>
#### Inspector visibility is a local presentation preference

The Camp Header provides one icon-only control that hides or restores the complete Inspector.
Inspector is visible by default. Renderer remembers the preference locally for the current
installation; changing it does not create a command, Camp event, message, audit entry or setting in
Core.

When hidden, Inspector leaves layout and accessibility flow completely. The conversation and
Composer use the freed width while retaining the same centered content track. Run and Approval
summaries remain in the Header. Activating a summary restores Inspector when necessary and opens
its authoritative tab.

The control is present only for an open Camp. It does not restore the removed Header Stop or
overflow menu and does not create a collapsed rail, Drawer, resizable panel or narrow-screen
navigation mode.

<a id="adr-0084-stop-is-one-terminal-campturn-outcome-in-the-conversation-timeline"></a>
#### Stop is one terminal CampTurn outcome in the conversation timeline

Renderer projects exactly one Stop outcome for each terminal cancelled CampTurn:

```text
你已在 {elapsed} 后停止
```

The projection is built from the authoritative Turn and event log:

- it is shown only when `status=cancelled` and `cancelRequestedAt` is present;
- its position uses the matching `camp_turn.cancel_requested` global sequence when available,
  with `cancelRequestedAt` as the stable fallback;
- elapsed time is the non-negative duration from Turn creation to cancellation request;
- it is not a CampMessage, does not consume message sequence, and is not copied into Agent input;
- a multi-Agent or A2A execution tree still produces one outcome because Stop owns the CampTurn.

ADR-0079's two-phase presentation remains intact. Before Core confirms the terminal state, every
affected non-terminal Run immediately shows “正在停止…”, loses active animation and rejects repeat
Stop. After terminal reconciliation, the persistent outcome replaces member-adjacent cancellation
labels in the conversation. Inspector Activity continues to expose each Run's authoritative
terminal state.

If any Run in the cancelled Turn has unsettled external effects, the outcome additionally displays
“结果待确认” and provides a control that opens Inspector Activity. The projection never claims that
external effects were rolled back or did not execute.

<a id="adr-0084-copy-belongs-to-message-content"></a>
#### Copy belongs to message content

User, Agent and delivered A2A message bodies remain selectable and keyboard-copyable. Their copy
control is placed below the content inside the content surface rather than in author metadata.
The icon appears on content hover or keyboard focus and reports a short “已复制” result. Copying is
a Renderer action and produces no domain or audit event.

<a id="adr-0084-shared-top-bar-does-not-replace-page-content"></a>
#### Shared top bar does not replace page content

Member and Memory primary pages use the same 50px draggable top bar as Camp so their title,
navigation selection and macOS window drag surface remain consistent. Interactive controls stay
inside `no-drag` regions. Their existing production workbenches remain authoritative; prototype
member, memory and responsive-sidebar demo content is not adopted.

<a id="adr-0084-consequences"></a>
### Consequences

- Conversation reading width is user-controlled without losing Inspector evidence or tab state.
- Stop is clearly attributed to the user and remains reproducible after reload from existing
  authoritative facts.
- Renderer gains one mixed timeline projection, a local Inspector preference and Header-to-tab
  routing, but Core and snapshot schema do not change.
- Tests must cover ordering, one-per-Turn projection, unsettled-effect disclosure, accessible
  controls and Inspector-hidden layout.

<a id="adr-0084-rejected-alternatives"></a>
### Rejected Alternatives

- Keep Inspector permanently visible at every supported width.
- Retain a narrow collapsed Inspector rail or convert Inspector into a Drawer.
- Store Inspector visibility in Core or emit it into Camp audit.
- Create a synthetic system CampMessage for Stop.
- Show one Stop outcome per AgentRun.
- Remove the immediate “正在停止…” phase before Core confirms fencing.
- Keep terminal cancellation text beside every member message as well as the Turn outcome.
- Replace the current Member or Memory workbench with prototype demonstration data.

<a id="adr-0084-references"></a>
### References

- [ADR-0062: Interruptible Run Trees and Unsettled External Effects](../v0.17/decisions.md#adr-0062)
- [ADR-0077: Responsive CampTurn Cancellation Boundary](../v0.24/decisions.md#adr-0077)
- [ADR-0079: Two-Phase Cancellation Projection and Bounded Runtime Interrupt](../v0.24/decisions.md#adr-0079)
- [v0.26 Member Runtime Parameters](README.md)
<!-- legacy-adr-body:end id=ADR-0084 -->
<!-- legacy-adr:end id=ADR-0084 -->
