---
document_type: version-decisions
version: v0.43
lifecycle: historical
last_updated: 2026-08-18
---

# v0.43 决策记录

本文件按来源版本聚合迁移前的数字 ADR，保存当时的背景、选择、后果与被拒绝方案。它是历史理由来源，不是当前系统规范真源；当前规范从 [文档导航](../../README.md) 进入。

## 历史 ADR 索引

| 历史 ID | 决策 | 迁移时状态 |
| --- | --- | --- |
| [ADR-0125](#adr-0125) | Runtime-Native Additive External MCP Projection | `accepted` |
| [ADR-0126](#adr-0126) | Codex Native Home and External Session Ownership | `accepted` |
| [ADR-0127](#adr-0127) | Atomic Member Runtime Configuration and Internal Resolved Binding | `accepted` |
| [ADR-0128](#adr-0128) | Structured Draft-Only User Camp Message Submission | `accepted` |

<!-- legacy-adr:begin id=ADR-0125 source-file-sha256=8da9374624f79fd15cf0177e5169016417e4ee66f29f699c8744b478ce5fdb25 -->
<a id="adr-0125"></a>

## ADR-0125: Runtime-Native Additive External MCP Projection

迁移时原路径：`docs/adr/0125-runtime-native-additive-external-mcp-projection.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0125
title: Runtime-Native Additive External MCP Projection
status: accepted
date: 2026-08-06
decision_scope: cross-version
source_version: v0.43
supersedes:
  - ADR-0104
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0125 -->
> 本决策替代 [ADR-0104](../v0.37/decisions.md#adr-0104)
> 的全 Runtime Rovai 同名优先、exact ambient isolation 与清空外部 MCP 后重试语义；局部
> 替代 [ADR-0018](../v0.09/decisions.md#adr-0018) 的 exact per-Run
> Projection、Project 配置排除和 Unsupported 发送准入条款。MCP Library、稳定 Server ID、
> Assignment、逐 AgentRun 冻结 Projection Input、Exposure Snapshot、凭据 redaction 和
> Runtime-native approval 边界继续有效。

<a id="adr-0125-context"></a>
### Context

Rovai 过去为了保证 Assigned MCP 精确覆盖 Runtime 原生配置，会禁用、隐藏或隔离用户与项目
MCP，并在 Runtime 拒绝注入时清空整组外部 MCP 后重试。这一模型把用户原生 Runtime 环境视为
污染源，也让同一 MCP Assignment 在 Adapter 内承担了配置意图、可用性保证和启动降级三种
不同责任。

v0.42 已把 Rovai built-in operations 完全迁移到 bundled CLI；外部 MCP 不再需要为内部 Team
Gateway 取得 exact namespace。产品现在选择保留 Runtime 原生 MCP，把 Rovai Assignment 解释为
尽力追加请求，并从最终 Exposure 诚实报告每个 Server 的实际结果。

<a id="adr-0125-decision"></a>
### Decision

<a id="adr-0125-只有-additive-与-unsupported-两种能力"></a>
#### 只有 Additive 与 Unsupported 两种能力

`ExternalMcpProjection` 只包含：

- `AdditivePerRun`：保留 Runtime 原生 MCP，并为本 AgentRun 尝试追加 ready 的 Rovai MCP；
- `Unsupported`：Adapter 没有不修改用户配置的可靠动态追加通道。

系统不保留 `ExactPerRun`、`ReplacementPerRun`、隐式 replacement fallback 或 dead capability
variant。一个 Adapter 若未来只能通过 replacement 支持外部 MCP，必须在后续版本重新形成明确
产品决策，不能复用本合同的 additive 名称。

<a id="adr-0125-projection-分为-core-request-与-adapter-finalization"></a>
#### Projection 分为 Core Request 与 Adapter Finalization

Core 先从冻结的 MCP Projection Input 生成 Requested Projection，只判断 Definition、enablement、
Assignment、环境解析和 transport 支持，不猜测 Runtime 原生 MCP。

Adapter 再根据当前 Runtime 实际配置层和自己的 channel 完成 Finalization。最终 Exposure 至少
区分 `ready`、`disabled`、`unassigned`、`adapter_unsupported`、`missing_environment`、`invalid`
和 `skipped_native_name_conflict`，并记录 projection mode、Same-Name Policy、collision
disposition 及非敏感 reason。Runtime-visible name mapping 只有 Adapter 确实使用私有名称时存在。

<a id="adr-0125-同名策略是-adapter-能力"></a>
#### 同名策略是 Adapter 能力

同名比较使用 canonical MCP Server Name 的 ASCII case-folded 语义，禁止把两个同名对象做字段级
merge。

- Codex 使用 `NativeWinsSkip`：从目标 app-server 的有效配置层发现原生名称；同名 Rovai Server
  不注入，并以 `skipped_native_name_conflict` 记录；
- OpenCode、Copilot、Claude Code、Kiro、Qoder、CodeBuddy 和 Qwen Code 使用 `RovaiWins`，但
  只有真实 Runtime 验收证明其高优先级 channel 会整项覆盖同名定义时才能声明 ready；
- Antigravity 当前为 `Unsupported`，因为只有 Global/Workspace 配置文件而没有可靠的
  Session-scoped dynamic channel。

Assignment 因此是期望投影意图，不是跨 Runtime 的同名 authority 保证。产品必须从 Exposure
说明最终生效者，不能把碰巧同名的原生 Server 冒充 Rovai Server。

<a id="adr-0125-没有-runtime-wide-降级或运输-fallback"></a>
#### 没有 Runtime-wide 降级或运输 fallback

Definition-local 的 disabled、unassigned、missing environment、invalid、unsupported 或 native
collision 只影响相应 Entry；基础 AgentRun 可以继续，并在 Exposure 中留下精确结果。

一旦 Adapter 把 Entry finalise 为 `ready` 并声明 `AdditivePerRun`，Runtime 若拒绝该注入，说明
Adapter capability 不成立，AgentRun 启动失败。系统不得清空全部 MCP 后重启、自动切换到
replacement、改用新 request input 或把失败 Entry 改写成成功。

<a id="adr-0125-配置与诊断分离"></a>
#### 配置与诊断分离

MCP 设置页始终允许用户为有效 AgentProfile 配置 Assignment，不按当前 Product Runtime 过滤、
禁用或警告。Runtime 是否支持动态追加以及某个 AgentRun 的最终 Exposure 只显示在诊断页；它
不改变 Member eligibility、Assignment 持久化或普通配置流程。

Adapter 不写入或临时覆盖用户的 Runtime Global/Project/Workspace MCP 配置。进程内参数、
Session config、高优先级环境内容和 Rovai-owned 私有临时文件是允许的动态通道；无法满足时
必须报告 `Unsupported`。

<a id="adr-0125-consequences"></a>
### Consequences

- AgentRun 可以同时使用用户原生 MCP 与不同名的 Rovai MCP，不再以 exact isolation 为产品承诺。
- 同名行为不再跨 Runtime 完全一致，但每个 Adapter 的策略和最终处置都有冻结证据。
- 已分配 Server 的局部不可用不阻断基础 Run；已声明 ready 后的运输拒绝则 fail closed。
- Antigravity 成员仍能正常保存 Assignment，但当前 Run 不动态注入，并仅在诊断页披露。
- Runtime Smoke 必须分别证明原生不同名保留、同名策略、逐项 Exposure 和 ready 注入拒绝路径。

<a id="adr-0125-rejected-alternatives"></a>
### Rejected Alternatives

- 保留 exact/replacement 作为默认或 fallback：会继续删除原生能力，并产生未公开的 authority
  切换。
- 保留未使用的 `ReplacementPerRun` variant：可序列化 capability 不是无害扩展点，会形成没有
  实现和验收的假合同。
- 全 Runtime 强制 Rovai 同名优先：Codex 需要私有 alias 或重新建立配置隔离。
- 全 Runtime 强制 Native 同名优先：会放弃其他 Runtime 已证明的高优先级整项覆盖能力，并增加
  不可靠的跨 Runtime 原生配置发现。
- Runtime 拒绝后清空外部 MCP 重试：会把 Adapter capability 失败伪装成正常启动。
- 为 Antigravity 临时改写 `.agents/mcp_config.json`：可能污染工作区、覆盖并发用户修改、在崩溃后
  留下配置或凭据，并无法约束外部 Antigravity 进程。

<a id="adr-0125-references"></a>
### References

- [v0.43 Runtime-native additive MCP](README.md)
- [ADR-0018: File-Backed MCP Library and Per-Run Runtime Projection](../v0.09/decisions.md#adr-0018)
- [ADR-0103: Canonical MCP JSON and Stable Assignment Identity](../v0.37/decisions.md#adr-0103)
- [ADR-0124: CLI-Only Transport for Rovai Built-in Operations](../v0.42/decisions.md#adr-0124)
<!-- legacy-adr-body:end id=ADR-0125 -->
<!-- legacy-adr:end id=ADR-0125 -->

<!-- legacy-adr:begin id=ADR-0126 source-file-sha256=b16adb881ce30525f81e7d8b1efc604facd72c71d25b39b81393533899d354da -->
<a id="adr-0126"></a>

## ADR-0126: Codex Native Home and External Session Ownership

迁移时原路径：`docs/adr/0126-codex-native-home-and-external-session-ownership.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0126
title: Codex Native Home and External Session Ownership
status: accepted
date: 2026-08-06
decision_scope: cross-version
source_version: v0.43
supersedes:
  - ADR-0107
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0126 -->
> 本决策替代 [ADR-0107](../v0.39/decisions.md#adr-0107)
> 的 `(campId, agentProfileId)` Isolated Codex Home、配置复制、Camp cleanup、orphan GC 和
> 物理 Session 隔离；局部替代 [ADR-0123](../v0.41/decisions.md#adr-0123) 的 Codex
> Home compatibility identity。ADR-0123 的 AgentRun 独占 lease、Resident 配额、quiescence、
> fencing 和 Core restart 语义继续有效。
> [ADR-0129](../v0.44/decisions.md#adr-0129) 删除 Camp 公共历史摘要
> Job；本文关于普通 AgentRun 使用 Codex Native Home 及外部 Session 所有权的规则继续有效。

<a id="adr-0126-context"></a>
### Context

Isolated Codex Home 最初用于阻止 user MCP 与 Rovai MCP 在同名 key 上深度合并，同时保存按
Camp/AgentProfile 隔离的 Codex rollout。它要求复制用户配置、删除原生 `mcp_servers`、禁用
Project `.codex`、共享认证和插件状态、维护 Home marker/lock/cleanup，并把外部 MCP 摘要纳入
Codex process compatibility。

在 ADR-0125 的 additive 模型下，Rovai 不再承诺清除 ambient MCP。Codex 可以先读取实际有效
配置，跳过同名 Rovai Server，再通过 thread config 只追加不存在的 key。继续维护独立 Home
只会保留一套不再需要的配置所有权和 Session 生命周期。

<a id="adr-0126-decision"></a>
### Decision

<a id="adr-0126-所有-codex-进程使用-codex-自己解析的-home"></a>
#### 所有 Codex 进程使用 Codex 自己解析的 Home

Rovai 启动任何 Codex app-server 时都不设置或覆盖 `CODEX_HOME`，不删除 `CODEX_SQLITE_HOME`，
不创建 `<Rovai data>/codex-homes/<camp>/<agentProfile>`。用户、Project、managed、plugin、hook、
memory 和其他 Codex 原生配置按目标 executable、process environment 与 cwd 的原生规则生效。

Rovai 不再拥有 Codex Home marker、config generation、Home lock、Camp cleanup record、72 小时
orphan GC 或 Home rebuild 路径。Camp 删除不触碰 Codex 原生文件。

v0.43 以 managed local-data clean break 删除旧版本遗留的 Rovai-owned `codex-homes`；这只清理
Rovai 先前创建的隔离副本，不解析、迁移或删除 Codex 原生 Home。Camp 公共历史摘要等内部
Codex Job 也继承同一个 Native Home；它们通过私有 cwd、ephemeral thread、tool-disabled config
和工具事件 fail-closed 约束副作用，不再建立临时 Home 例外。

<a id="adr-0126-rovai-只拥有-native-binding"></a>
#### Rovai 只拥有 Native Binding

Rovai 在 Conversation 中只持久保存 Codex `thread.id` 及现有 Native Binding evidence。Resume
直接对当前原生 Home 执行 `thread/resume`；成功则继续，失败或找不到 rollout 时按现有 fenced
replacement 语义创建新 thread。

Conversation 的“私有连续性”是 Rovai 路由和 portable context 的逻辑边界，不承诺 Codex 文件按
Camp/AgentProfile 物理隔离。删除 Camp 只删除 Rovai 数据和 Binding，不能宣称删除了外部 Runtime
thread、日志、memory、插件状态或其他本地数据。

<a id="adr-0126-codex-mcp-使用-config-discovery-与-thread-scoped-addition"></a>
#### Codex MCP 使用 config discovery 与 thread-scoped addition

app-server 初始化后、`thread/start` 或 `thread/resume` 前，Adapter 通过
`config/read(includeLayers=true, cwd=executionRoot)` 收集所有有效层的 native top-level MCP
名称。Same-name 比较完成后，只把不同名的 Rovai Server 作为 `config.mcp_servers` 传给
`thread/start` / `thread/resume`；配置对象不得包含已发现的同名 key。

`config/read` 是 discovery evidence，不再验证 user layer 必须来自 Rovai Home、不再拒绝有效
Project/managed MCP，也不要求 effective MCP 集合精确等于 Rovai Assignment。

<a id="adr-0126-fleet-compatibility-不包含-conversation-home-或-thread-mcp"></a>
#### Fleet compatibility 不包含 Conversation Home 或 thread MCP

Codex app-server 可以在独占 lease 和 quiescence 证明下，继续服务 Fleet compatibility 相同但
Assignment 不同的后续 Run。process compatibility 只包含 executable/config、cwd、permission、
Built-in CLI、attachment root 等真正的 process-scoped 输入；thread-scoped external MCP 不进入
digest。

每次 Fleet acquire 都重新读取当前 native MCP 名称、finalise 本 Run 的 additive projection，
再创建或恢复 thread。旧 Run lease 和迟到调用继续 fail closed。

<a id="adr-0126-consequences"></a>
### Consequences

- Codex 原生配置、Project `.codex`、plugins 和 Session rollout 不再复制或与用户环境漂移。
- Rovai 删除大量 Home、cleanup、GC、config validation 和 rebuild replacement 代码。
- Camp 公共历史摘要与普通 AgentRun 使用一致的 Native Home ownership；摘要 Job 不建立持久
  Native Binding，并继续在任何工具事件发生时失败。
- Codex 原生状态可以被用户的其他 Codex surface 看见和管理；Rovai 不提供物理隔离或删除保证。
- 一个 warm app-server 可以在既有 Fleet compatibility 边界内串行复用，外部 MCP 在 thread 层
  每 Run finalise。
- 原生配置变化可能影响后续 Run；MCP Projection Input 仍冻结 Rovai 请求，而 native collision
  discovery 反映该次启动实际环境并进入最终 Exposure。

<a id="adr-0126-rejected-alternatives"></a>
### Rejected Alternatives

- 继续保留 Isolated Home 但不写 MCP：仍需承担配置 snapshot、认证/plugin link、Session cleanup
  和跨 Home process identity，没有对应产品收益。
- 只删除 Home 中的 `rovai_team`：v0.42 已删除 built-in MCP，且 ADR-0107 的持久 Home 原本只保存
  external MCP。
- 继续用 whole-table override：Codex 对同名 nested table 深度合并，可能重新产生混合 transport。
- 删除 Camp 时调用 Codex 删除 thread：Rovai 不拥有原生 Session 文件，也不能把外部删除结果纳入
  Camp 事务。

<a id="adr-0126-references"></a>
### References

- [v0.43 Runtime-native additive MCP](README.md)
- [Codex MCP Configuration Collision postmortem](../../postmortems/2026-08-05-codex-mcp-configuration-collision.md)
- [ADR-0123: Exclusive AgentRun Runtime Processes and Resident Fleet Reuse](../v0.41/decisions.md#adr-0123)
- [ADR-0125: Runtime-Native Additive External MCP Projection](decisions.md#adr-0125)
<!-- legacy-adr-body:end id=ADR-0126 -->
<!-- legacy-adr:end id=ADR-0126 -->

<!-- legacy-adr:begin id=ADR-0127 source-file-sha256=7aae125d5a967d6e7daff093d08a83bb8f126e9c8288397c74dcfbf0f0fcb65b -->
<a id="adr-0127"></a>

## ADR-0127: Atomic Member Runtime Configuration and Internal Resolved Binding

迁移时原路径：`docs/adr/0127-atomic-member-runtime-configuration.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0127
title: Atomic Member Runtime Configuration and Internal Resolved Binding
status: accepted
date: 2026-08-06
decision_scope: cross-version
source_version: v0.43
supersedes:
  - ADR-0082
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0127 -->
<a id="adr-0127-context"></a>
### Context

ADR-0082 made model and permission parameters explicit but retained an unresolved, adapter-only
Product Runtime Selection as a valid persisted state. Public AgentProfile contracts consequently
exposed both selection/preference records and Runtime Readiness, including an internal Installation
identity. That creates two configuration models and lets background Runtime resolution appear able
to complete a Member configuration that the user never atomically confirmed.

The product contract needs one answer to “what Runtime configuration did this Member save?” while
Core still needs a separate launch-time binding containing managed Installation evidence.

<a id="adr-0127-decision"></a>
### Decision

<a id="adr-0127-member-configuration-is-complete-or-absent"></a>
#### Member configuration is complete or absent

`MemberRuntimeConfiguration` is the only persisted and publicly projected Member Runtime value. It
contains Product Runtime, model policy and Adapter-native permission configuration as one atomic
value. The version-checked save command accepts all three components together and succeeds only
when Core can validate them against a ready Managed Default Installation and its current capability
snapshot.

An adapter-only choice is editor draft state, not durable Member state. If Installation discovery,
authentication, probing or capability validation is incomplete, the save rejects without changing
the prior configuration. A Member with no successful complete save has no Runtime configuration and
projects `runtime_not_configured`.

Background discovery and refresh may update Installation and capability evidence, but never create,
complete or repair a Member Runtime Configuration. Capability drift may change Runtime Readiness to
`needs_attention`; it never rewrites the saved value.

<a id="adr-0127-resolved-binding-is-internal-execution-state"></a>
#### Resolved binding is internal execution state

Core resolves a complete Member Runtime Configuration to an internal `ResolvedRuntimeBinding` that
may contain AdapterInstallation ID and other launch evidence. It is used for dispatch, diagnostics
and frozen Run Runtime Configuration, not for ordinary AgentProfile reads or Member edits.

The public AgentProfile projection contains only optional `runtimeConfiguration` and
`runtimeReadiness`. Installation identity, executable path, discovery provenance and fingerprints
remain in Installation/diagnostic boundaries.

This replaces ADR-0082's unresolved-selection exception and public preference model, and locally
replaces ADR-0066 clauses that treated an AdapterKind-only Product Runtime Selection as the durable
ordinary Member configuration. ADR-0066's managed discovery, relocation and Installation ownership
continue to apply internally.

<a id="adr-0127-clean-break"></a>
#### Clean break

The current projection schema resets Rovai-owned local data rather than translating partial Runtime
preferences. No compatibility field, dual read or automatic completion remains. User projects,
Codex Native Home and external Runtime state are outside the reset boundary.

<a id="adr-0127-consequences"></a>
### Consequences

- Member settings and AgentProfile reads have one configuration shape.
- Runtime availability can be inspected before a configuration can be saved, without persisting a
  partial preference.
- Installation identity stays available to Core and diagnostics without leaking into product DTOs.
- Users must retry an explicit complete save after the selected Runtime becomes available.

<a id="adr-0127-rejected-alternatives"></a>
### Rejected Alternatives

- Persist AdapterKind while awaiting discovery: recreates a second, incomplete configuration model.
- Expose Installation ID in AgentProfile: mixes product configuration with launch binding evidence.
- Materialize defaults after discovery: changes user configuration without an accepted user command.
- Translate partial historical preferences: preserves the ambiguity this decision removes.

<a id="adr-0127-references"></a>
### References

- [ADR-0066: Managed Product Runtime Resolution](../v0.20/decisions.md#adr-0066)
- [ADR-0082: Member-Owned Runtime Parameters](../v0.26/decisions.md#adr-0082)
- [ADR-0118: Local Data Clean Break](../v0.41/decisions.md#adr-0118)
- [v0.43 version scope](README.md)
<!-- legacy-adr-body:end id=ADR-0127 -->
<!-- legacy-adr:end id=ADR-0127 -->

<!-- legacy-adr:begin id=ADR-0128 source-file-sha256=7b6f2fc4924dd2b573d087dfd3f7508738cd3e6ed66ac788b47ce454f385725c -->
<a id="adr-0128"></a>

## ADR-0128: Structured Draft-Only User Camp Message Submission

迁移时原路径：`docs/adr/0128-structured-draft-only-user-message-submission.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0128
title: Structured Draft-Only User Camp Message Submission
status: accepted
date: 2026-08-06
decision_scope: cross-version
source_version: v0.43
supersedes:
  - ADR-0096
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0128 -->
<a id="adr-0128-context"></a>
### Context

ADR-0096 established Structured Camp Message Content and exact Draft revision as the intended user
send boundary, but retained two compatibility gaps: Core could still accept body, attachment IDs and
caller-supplied addressing without a Draft revision, and messages without structured content could
still be created or read as legacy Text. The obsolete `create_camp_from_first_message` service also
kept Camp creation, membership, Runtime admission, Conversation allocation and first send in one
call despite ADR-0071 separating those responsibilities.

These reachable Core contracts make structured content and derived addressing optional in practice.

<a id="adr-0128-decision"></a>
### Decision

<a id="adr-0128-exact-draft-revision-is-the-only-user-write-entry"></a>
#### Exact Draft revision is the only user write entry

The user-facing send command is `SendUserCampDraftCommand` with `campId`, required
`draftRevision`, optional reply target and execution intent. Core reads the authoritative Draft,
validates its structured content and prepared attachments, derives body and addressing, then
atomically creates the message/turn/runs and consumes the exact revision.

No public user command accepts body, Prepared Attachment IDs, address mode or recipient IDs.
`MessageAddressSpec`, legacy send parameters and the user-identity legacy send function do not exist.

<a id="adr-0128-every-campmessage-has-structured-content"></a>
#### Every CampMessage has structured content

Structured Camp Message Content is required storage for user, Agent and system messages. Body,
addressing, recipient indexes and semantic digest are projections. Internal Agent/system append
boundaries may accept trusted generated text or structured content, but they cannot accept Member
Mention routing or invoke the user command without a Draft.

The database rejects insertion or update of a CampMessage whose structured content is null. The
current Read Model returns non-null content and performs no Text synthesis from historical body.

<a id="adr-0128-camp-creation-remains-separate"></a>
#### Camp creation remains separate

Configured Camp creation creates only the Camp and its selected CampMembers. It creates no first
message, Conversation, Turn or Run and performs no Runtime Readiness admission. The obsolete
first-message creation command and service are deleted rather than retained as an internal shortcut.
Lazy Conversation allocation continues under ADR-0071 when an admitted execution targets a Member.

<a id="adr-0128-current-identities-and-format-versions"></a>
#### Current identities and format versions

Mention and Member Call fields carry Agent IDs and are named `agentId`, `senderAgentId` and
`recipientAgentId`; there is no Member ID or public AgentProfile ID. Renderer tokens use
`data-agent-id`. Model-visible formatting changes are frozen as AgentRun Context formatter version
8, with one shared Rust/TypeScript fixture.

<a id="adr-0128-clean-break"></a>
#### Clean break

The projection schema resets Rovai-owned local data containing null structured messages instead of
backfilling guessed Text segments. No dual read/write or legacy alias remains. User projects, Codex
Native Home and external Runtime state are not changed.

<a id="adr-0128-consequences"></a>
### Consequences

- Draft content, visible Mention identity and actual routing cannot diverge through a second command.
- Read Model consumers can treat message content as required.
- Tests that need messages must construct a structured Draft or use test-only helpers that do so.
- Existing incompatible Rovai development data is discarded at the managed reset boundary.

<a id="adr-0128-rejected-alternatives"></a>
### Rejected Alternatives

- Keep a private-looking legacy user send: internal callers would still create a second truth source.
- Project null messages to Text: preserves an unsupported historical schema indefinitely.
- Retain first-message Camp creation for tests: makes test fixtures depend on rejected production semantics.
- Keep Member/AgentProfile ID aliases: invites new protocol fields for an identity that does not exist.

<a id="adr-0128-references"></a>
### References

- [ADR-0071: Configured Camp Creation and Lazy Conversations](../v0.22/decisions.md#adr-0071)
- [ADR-0080: Durable Camp Composer Draft](../v0.25/decisions.md#adr-0080)
- [ADR-0096: Structured Mentions and Derived Addressing](../v0.33/decisions.md#adr-0096)
- [ADR-0118: Local Data Clean Break](../v0.41/decisions.md#adr-0118)
- [v0.43 version scope](README.md)
<!-- legacy-adr-body:end id=ADR-0128 -->
<!-- legacy-adr:end id=ADR-0128 -->
