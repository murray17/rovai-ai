---
document_type: version-decisions
version: v0.16
lifecycle: historical
last_updated: 2026-08-18
---

# v0.16 决策记录

本文件按来源版本聚合迁移前的数字 ADR，保存当时的背景、选择、后果与被拒绝方案。它是历史理由来源，不是当前系统规范真源；当前规范从 [文档导航](../../README.md) 进入。

## 历史 ADR 索引

| 历史 ID | 决策 | 迁移时状态 |
| --- | --- | --- |
| [ADR-0059](#adr-0059) | Runtime-Owned Resource Permissions and Path-Only Run Workspace | `accepted` |
| [ADR-0060](#adr-0060) | Opaque Member Routing Identity and Globally Unique Names | `accepted` |

<!-- legacy-adr:begin id=ADR-0059 source-file-sha256=c1bf95e9c184138004654888387d201e8ff277a63412a374eba6ae9121d0cc56 -->
<a id="adr-0059"></a>

## ADR-0059: Runtime-Owned Resource Permissions and Path-Only Run Workspace

迁移时原路径：`docs/adr/0059-runtime-owned-resource-permissions.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0059
title: "Runtime-Owned Resource Permissions and Path-Only Run Workspace"
status: accepted
date: 2026-07-28
decision_scope: cross-version
source_version: v0.16
supersedes: [ADR-0015]
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0059 -->
<a id="adr-0059-context"></a>
### Context

ADR-0015 made Rovai-ai Core a second resource-authorization layer above every native Agent
Runtime. Core froze `executionRoot`, `read_only | write` and an Action Permission Envelope,
then evaluated Shell, filesystem, Git, network and Runtime permission requests against those
generic rules.

That model conflicts with the actual multi-Runtime boundary:

- each Adapter already exposes its Runtime's native permission configuration;
- native Runtimes differ in sandbox, approval option, session lifetime and dynamic permission
  semantics;
- an A2A target Run currently receives the sender's complete `workspace_json`, so a sender's
  Core-level `read_only` value can override the recipient Agent's own Runtime configuration;
- Core may reject a Runtime request for another directory before the user can see and decide the
  native request;
- a generic Core policy cannot faithfully represent every supported Runtime without becoming a
  second, drifting sandbox.

Rovai-ai must continue to show real Runtime permission requests, persist user decisions, fence
stale callbacks and protect files owned by Rovai-ai itself. Those responsibilities do not require
Core to authorize an Agent's resource access.

This ADR replaces ADR-0015 in full. It preserves durable recording and recovery only for effects
and permission requests that Core actually mediates or the Runtime actually reports; it removes
the claim that every Agent resource operation must first pass a Core Action policy.

<a id="adr-0059-decision"></a>
### Decision

<a id="adr-0059-resource-authority-belongs-to-the-recipient-runtime"></a>
#### Resource authority belongs to the recipient Runtime

For every new AgentRun, filesystem, Shell, Git, network and Runtime-tool resource permissions are
owned by:

```text
recipient AgentProfile
→ recipient Adapter Permission Configuration
→ frozen recipient Run Runtime Configuration
→ native Runtime
```

Core must not:

- inherit the sender Run's permission configuration;
- intersect sender and recipient resource capabilities;
- derive resource authority from Run Workspace;
- reject an Agent operation because its target is outside `executionRoot`;
- reject a write because a legacy Workspace field says `read_only`;
- decide that an Approval cannot increase a Runtime's native resource scope;
- create a generic allow/ask/deny policy for Agent filesystem, Shell, Git or network operations.

The recipient's Adapter, model and Adapter Permission Configuration are resolved from the
recipient AgentProfile and frozen when the target AgentRun is created. Later profile changes
affect only later Runs. Native session-scoped decisions retain their upstream Runtime meaning and
remain owned by that Runtime.

This boundary does not remove Core business authorization. Member Presence, Camp membership,
Team Tool capabilities, Task mutation capabilities, Runtime Readiness, A2A depth and quotas,
Native Binding identity, execution epochs, idempotency and command fencing remain Core-enforced.

<a id="adr-0059-permission-semantics-are-versioned-per-run"></a>
#### Permission semantics are versioned per Run

AgentRun freezes one internal permission interpretation:

```text
core_enforced_v1
runtime_managed_v2
```

Every Run created after the v0.16 migration uses `runtime_managed_v2`. Only Runs that were
non-terminal at upgrade retain `core_enforced_v1`, so an unfinished legacy Run can recover under
the semantics with which it began. Pre-upgrade terminal Runs never re-enter execution; their
historical Action/Approval/Workspace records retain their original facts without requiring an
active v1 execution path.

This is a compatibility discriminator, not a user-selectable product mode. The product does not
offer a permanent `RuntimeManaged | CoreEnforced` preference. After no recoverable v1 Run remains,
a later migration may delete v1 behavior and obsolete fields.

Physical fields including `execution_root`, `access` and `workspace_json` may remain during the
compatibility period. Under `runtime_managed_v2`, `access` and any legacy Action Permission
Envelope have no resource-authorization effect.

<a id="adr-0059-run-workspace-is-a-working-directory-snapshot"></a>
#### Run Workspace is a working-directory snapshot

The logical Run Workspace is:

```rust
struct Workspace {
    path: PathBuf,
}
```

It is the immutable absolute, existing directory used to start and recover one AgentRun. Core may
verify that it is usable as a process working directory before launch. It is not a sandbox root,
allowlist, repository ownership claim or permission grant.

An Agent may use its Runtime to access or switch to another directory. Core does not compare that
operation with the frozen Workspace path.

<a id="adr-0059-a2a-does-not-gain-a-workspace-argument"></a>
#### A2A does not gain a Workspace argument

`team.post_message` keeps its existing model-controlled schema: recipient, body, generic
references and optional reply linkage. It gains no `workspacePath`, `taskId`, `parentRunId`,
permission or capability argument.

When Core creates an A2A target Run:

- the startup/recovery working-directory path is copied deterministically from the source Run;
- no sender Workspace access value or sender Runtime permission configuration is copied;
- the target uses the recipient's newly frozen Run Runtime Configuration;
- the target does not inherit the source Run's optional Task association;
- parent Run, root Run and A2A depth are derived from the authenticated source binding;
- target context is assembled under the existing reproducible-context rules rather than copying
  the sender's complete prompt or private Conversation.

If the recipient should work in another directory, the sending Agent expresses that requirement
as ordinary message content or durable Task description. The recipient interprets it and changes
or targets directories through its own Runtime. Core does not parse that prose into authority or
Run metadata.

<a id="adr-0059-native-permission-requests-remain-user-visible"></a>
#### Native permission requests remain user-visible

When a Runtime with structured dynamic approval support emits a permission request, Rovai-ai:

1. validates only the current Binding, Run, epoch, native request identity and round-trip shape;
2. durably records the exact native request, stable digest and native decision options;
3. shows the request and those options to the target user;
4. records the user's selected native option;
5. delivers the exact corresponding result to the same fenced Runtime request;
6. records delivery acknowledgement or an honest recovery/failure state.

Core does not re-evaluate the requested path or operation against Workspace or a generic resource
policy. A Runtime permission request from an otherwise valid current Run is not suppressed by the
legacy `action.request` Capability.

The UI may localize labels and explain consequences, but it must preserve the native option ID,
scope and lifetime. A one-off decision never silently edits the AgentProfile's Adapter Permission
Configuration. A session decision remains scoped exactly as the Runtime defines it.

If an Adapter cannot round-trip a request or its choices without guessing, it fails closed with an
explicit Runtime/Adapter diagnostic. It must not auto-approve, invent an Approval, map to a wider
option or reinstate Core resource authorization. Runtimes without structured dynamic approval run
with their frozen Adapter configuration and expose the missing capability honestly.

<a id="adr-0059-runtime-action-recording-is-observationally-honest"></a>
#### Runtime action recording is observationally honest

Core creates a Runtime Action Record only when:

- a native Runtime permission request was actually received;
- a Runtime reported an action or result;
- or Core itself mediated a separately authorized application/domain operation.

Core does not synthesize ActionExecutions or Approvals for operations that the Runtime neither
requested nor reported. Absence of a Runtime Action Record is therefore not proof that no resource
operation occurred.

For recorded requests and effects, stable identity, request/result digests, epoch fencing,
delivery checkpoints and `unknown` outcome semantics remain. Unknown-effect reconciliation applies
only to a genuinely tracked dispatch or reported effect; it cannot manufacture knowledge about an
unreported Runtime operation.

<a id="adr-0059-rovai-ai-owned-file-safety-remains-core-enforced"></a>
#### Rovai-ai-owned file safety remains Core-enforced

This decision does not weaken file safety for resources managed by Rovai-ai itself. Core continues
to enforce path, traversal, symlink, ownership, permission, size and atomic-write rules for:

- avatar and managed blob assets;
- Skill, MCP and Memory projections;
- private Runtime configuration and credentials;
- local sockets, logs and temporary files;
- database, migration and application-owned export/import paths.

These checks protect application integrity. They do not authorize or restrict the Agent Runtime's
general filesystem access.

<a id="adr-0059-consequences"></a>
### Consequences

- A2A execution can no longer become accidentally read-only because its sender was read-only.
- Each Agent behaves according to its own upstream Runtime configuration, including native
  approval lifetime and sandbox semantics.
- The user still sees real directory, command and other structured Runtime permission requests in
  Rovai-ai and can choose among the native options.
- Core no longer claims complete knowledge or prior authorization of every Agent resource effect.
- Action/Approval persistence becomes a faithful relay and audit mechanism rather than a second
  cross-Runtime policy engine.
- Legacy Run recovery requires a temporary dual implementation path and an explicit migration
  discriminator.
- Retained Workspace and Action-policy fields may look authoritative unless read models,
  diagnostics and tests clearly label or hide their legacy-only meaning.
- Adapter contract and real-Runtime tests become more important because permission correctness now
  depends on lossless upstream configuration and request/result translation.

<a id="adr-0059-rejected-alternatives"></a>
### Rejected Alternatives

- Continue copying complete `workspace_json` over A2A: rejected because it transfers sender
  permission semantics into an independently configured recipient.
- Add `workspacePath` to `team.post_message`: rejected because working-directory changes can be
  expressed in task semantics and do not belong in the model-controlled Team Tool contract.
- Store Workspace on Task: rejected because Task responsibility is durable collaboration state,
  while working directory is a per-Run launch concern.
- Let the LLM provide `parentRunId` or a complete context blob: rejected because lineage and
  reproducible context are Core-derived trusted state.
- Keep a generic Core `read_only | write` sandbox above every Runtime: rejected because it
  duplicates and distorts Adapter-native permissions.
- Hide native Runtime requests because Core no longer authorizes them: rejected because user
  visibility and decision relay are still required.
- Synthesize an Approval for a Runtime without structured approval support: rejected because Core
  cannot safely pause or resume a protocol interaction that never occurred.
- Make `RuntimeManaged | CoreEnforced` a permanent user preference: rejected because it would
  preserve two competing authorization products indefinitely.
- Delete every legacy Workspace and Action field immediately: rejected because unfinished Runs and
  existing databases require recoverable migration.

<a id="adr-0059-references"></a>
### References

- [v0.16 Runtime 权限归属与 Workspace 语义收敛](README.md)
- [ADR-0014: Stable Team Tool Gateway v2](../v0.06/decisions.md#adr-0014)
- [Superseded ADR-0015: Action and Safety v2](../v0.06/decisions.md#adr-0015)
- [ADR-0016: Multi-Runtime Execution Boundary v2](../v0.06/decisions.md#adr-0016)
- [ADR-0049: Reproducible Context Delivery v2](../v0.12/decisions.md#adr-0049)
<!-- legacy-adr-body:end id=ADR-0059 -->
<!-- legacy-adr:end id=ADR-0059 -->

<!-- legacy-adr:begin id=ADR-0060 source-file-sha256=4f5d2f90f88447ed3b31b54457e2d620c6a698e495bb3517bb1c0203e93455a9 -->
<a id="adr-0060"></a>

## ADR-0060: Opaque Member Routing Identity and Globally Unique Names

迁移时原路径：`docs/adr/0060-opaque-member-routing-identity.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0060
title: "Opaque Member Routing Identity and Globally Unique Names"
status: accepted
date: 2026-07-28
decision_scope: cross-version
source_version: v0.16
supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0060 -->
> [ADR-0110](../v0.40/decisions.md#adr-0110) replaces the Base58 Member
> Routing ID with a monotonic short Agent ID and confines the old handle to historical text
> compatibility. This ADR's globally unique Member Name and structured Mention rules remain valid.
> [ADR-0129](../v0.44/decisions.md#adr-0129) 删除摘要模型配置、对应
> IPC/持久化链路以及成员详情中的“高级设置”入口；成员身份与结构化 Mention 规则不变。

<a id="adr-0060-context"></a>
### Context

早期版本把 `AgentProfile.handle` 同时作为稳定路由键、成员配置字段和 `@` 展示文本。
这让用户必须维护一个本应属于系统的标识，也迫使展示层在同名成员后追加 handle。
一旦 handle 进入历史消息，继续允许用户编辑或复用它又会破坏历史身份解析。

协作命令已经使用结构化 `agentProfileId` 作为权威地址。正文中的 `@` 文本主要承担
可读性和输入反馈，不需要继续暴露内部路由键。因此成员名称可以成为唯一的产品身份
标签，而 handle 收口为不透明的兼容标识。

摘要模型入口同时需要从独立“上下文”设置页移到成员 Runtime 附近，但这只是
Desktop 信息架构变化，不改变 ADR-0050 的摘要选择和持久化语义。

<a id="adr-0060-decision"></a>
### Decision

<a id="adr-0060-opaque-routing-identity"></a>
#### Opaque routing identity

`AgentProfile.id` 继续是领域外键和结构化寻址真源。`AgentProfile.handle` 保留为
稳定、不可编辑的内部兼容标识：

- 新建成员时，Core 生成 12 位 Base58 随机值并在事务内检查冲突；
- Desktop 和公开创建/编辑表单不接收或显示 handle；
- 编辑名称、头像、角色、指令或 Runtime 不修改 handle；
- 既有 Profile 的 handle 原样保留，不执行 SQLite Migration；
- removed Profile 的 handle 与身份记录继续保留。

为了兼容旧客户端，Core 的 Rust 命令反序列化可以接受旧 `handle` 字段，但创建时
忽略该值，更新时也不允许它改写已存 handle。

<a id="adr-0060-globally-unique-member-names"></a>
#### Globally unique member names

`displayName` 是成员配置与普通产品界面的唯一身份标签。所有未移除和已移除
AgentProfile 共同占用同一名称空间。Core 在创建和更新命令的同一事务中执行去除
首尾空白并忽略大小写的冲突检查；Desktop 在提交前执行更严格的兼容归一化预检，
并在表单下方显示错误。Core 检查仍是并发和非 Desktop 调用的最终权威。

本决策不批量重写已有名称。旧数据库若已经存在同名 Profile，后续创建或编辑不得
继续制造冲突；用户需要通过成员编辑逐个收敛名称。

<a id="adr-0060-mention-input-and-historical-display"></a>
#### Mention input and historical display

新 Composer 的候选和插入文本统一使用 `@成员名称`，路由仍提交结构化
`agentProfileId`。Core 保留对旧 handle mention 的兼容识别，并能校验当前名称形式
的 mention；正文文本不能替代结构化地址。

历史 Camp 标题、公共消息、Inbox 和其他可见正文中的旧 `@handle` 在 Renderer
展示层投影为 `@成员名称`，不改写 SQLite 历史正文。同名后追加 handle 的旧展示规则
被移除，因为新的权威写入已经禁止名称重复。

<a id="adr-0060-summary-model-entry"></a>
#### Summary model entry

Desktop 删除独立“上下文”设置入口。现有摘要模型表单移动到成员详情的“高级设置”，
默认折叠且只在用户展开后读取配置。它继续调用：

- `context.summaryModel.get`
- `context.summaryModel.set`
- `ContextSummaryModelConfig`
- `ContextSummaryModelPreference`

自动回退、执行引擎默认模型和明确模型三种选择保持不变。Core 摘要选择逻辑、
Contracts 数据形状和 SQLite 数据不变。

<a id="adr-0060-consequences"></a>
### Consequences

- 用户只管理和看到名称，不需要理解或维护内部 handle。
- 名称可以安全用于所有 `@` 展示，不再需要括号中的 handle 消歧。
- 新建成员的内部标识不可预测、不会从名称派生，改名也不影响历史引用。
- 旧 handle、旧消息正文和旧数据库无需迁移，升级风险较低。
- 名称唯一性由命令事务保证，而不是只依赖 Renderer 校验。
- 摘要模型入口更接近成员 Runtime 配置，同时仍明确它是所有 Camp 共享配置。

<a id="adr-0060-rejected-alternatives"></a>
### Rejected Alternatives

- 继续让用户填写 handle：把内部兼容键暴露为长期产品概念。
- 从名称生成 slug：改名、Unicode 和冲突处理会重新耦合显示名称与路由身份。
- 同名时展示 `名称（handle）`：持续暴露内部键并让名称不再是稳定的产品标签。
- 重写既有 handle 或历史消息：会产生无必要的数据迁移和历史身份风险。
- 为摘要模型创建新的 Core 配置：重复现有合同并扩大本次 UI 调整范围。

<a id="adr-0060-references"></a>
### References

- [v0.16 Runtime 权限归属与成员配置收口](README.md)
- [ADR-0050: Camp-Shared Progressive Summaries](../v0.12/decisions.md#adr-0050)
- [ADR-0057: Member Presence and Retained Permanent Removal](../v0.15/decisions.md#adr-0057)
- [ADR-0058: Collaboration v4](../v0.15/decisions.md#adr-0058)
<!-- legacy-adr-body:end id=ADR-0060 -->
<!-- legacy-adr:end id=ADR-0060 -->
