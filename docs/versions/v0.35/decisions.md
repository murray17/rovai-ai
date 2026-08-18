---
document_type: version-decisions
version: v0.35
lifecycle: historical
last_updated: 2026-08-18
---

# v0.35 决策记录

本文件按来源版本聚合迁移前的数字 ADR，保存当时的背景、选择、后果与被拒绝方案。它是历史理由来源，不是当前系统规范真源；当前规范从 [文档导航](../../README.md) 进入。

## 历史 ADR 索引

| 历史 ID | 决策 | 迁移时状态 |
| --- | --- | --- |
| [ADR-0100](#adr-0100) | Latest Member Identity in Native Session Bootstrap | `accepted` |

<!-- legacy-adr:begin id=ADR-0100 source-file-sha256=952d5848761930f50f8dc482570c27c59711f9c6d6cb9250b130aedaa4376724 -->
<a id="adr-0100"></a>

## ADR-0100: Latest Member Identity in Native Session Bootstrap

迁移时原路径：`docs/adr/0100-latest-member-identity-native-session-bootstrap.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0100
title: "Latest Member Identity in Native Session Bootstrap"
status: accepted
date: 2026-08-04
decision_scope: cross-version
source_version: v0.35
supersedes: [ADR-0085]
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0100 -->
> [ADR-0129](../v0.44/decisions.md#adr-0129) 仅重命名并重定义本文引用的
> Context Read Marker 为 Accepted Public Context Boundary；Member Identity 与 Bootstrap
> 生命周期规则继续有效。ADR-0129 同时替代本文对 `COLLABORATION_STATE` 注入瞬时
> availability、busy、reason 和当前 Turn 参与者提示的条款；该区段现在只投影稳定团队身份，
> 协作执行可用性由 `team.call_member` 在 Core 接受调用时重新判定。
>
> [ADR-0141](../v0.48/decisions.md#adr-0141)为受支持的普通上下文层 Runtime
> 新增 compaction 后的 eligible Bootstrap redelivery boundary；它复用本文“原稳定组件 + 最新
> Member Identity + 完整 Bootstrap 不持久化”的规则，局部替代“其他 Runtime 只在新 Session
> 收到 Bootstrap”的投递矩阵条款。

<a id="adr-0100-context"></a>
### Context

ADR-0085 placed the six-field Member Identity in every AgentRun Dynamic Context and froze it when
the AgentRun was created. That made one Run reproducible, but repeated stable personal context on
every request and let a queued or recovering Run continue from an identity that was no longer the
AgentProfile's current identity.

ADR-0067 separately treats the Native Session Bootstrap as one immutable two-section payload whose
complete bytes are recoverable from persisted evidence. Moving editable identity into that
Bootstrap creates a deliberate conflict: Session Charter and Memory Entrypoint must retain their
original Session evidence, while Member Identity must be refreshed at eligible Runtime start and
Resume boundaries without becoming another durable Session snapshot.

Rovai-ai therefore needs one precise delivery contract that preserves the six-field aggregate and
its privacy boundary while accepting that the complete formatted Bootstrap is no longer a
reproducible evidence object.

<a id="adr-0100-decision"></a>
### Decision

<a id="adr-0100-six-fields-remain-one-identity-aggregate"></a>
#### Six fields remain one identity aggregate

Member Identity still consists of Name, Team Role, Professional Responsibilities, ordered
Personality Traits, Working Principles and Growth Topic. `MemberIdentityUpdate` validates and
atomically saves exactly those six fields under AgentProfile optimistic concurrency. Avatar,
Runtime/model/native permissions, Presence and Memory Capability retain independent mutation and
UI save boundaries.

Identity fields grant no Capability, permission, approval, routing authority or proof of completed
work. Growth Topic remains context only: updating it creates no Memory, background job, growth log
or score and never revises, retires or forgets existing Memory.

<a id="adr-0100-bootstrap-has-three-sections-in-one-fixed-order"></a>
#### Bootstrap has three sections in one fixed order

The complete formatted Native Session Bootstrap is:

```text
[SESSION_CHARTER]
...
[/SESSION_CHARTER]

[MEMBER_IDENTITY]
{
  "schemaVersion": 1,
  "name": "...",
  "teamRole": "...",
  "professionalResponsibilities": "...",
  "personalityTraits": [...],
  "workingPrinciples": "...",
  "growthTopic": "..."
}
[/MEMBER_IDENTITY]

[MEMORY_ENTRYPOINT]
...
[/MEMORY_ENTRYPOINT]
```

`MEMBER_IDENTITY` is required and always lies between `SESSION_CHARTER` and
`MEMORY_ENTRYPOINT`. Its object uses schema version 1 and the displayed field order. Empty legal
values remain explicit rather than causing fields or the section to be omitted.

AgentRun Dynamic Context contains only:

```text
[COLLABORATION_STATE]?
[SHARED_CONVERSATION]?
[RUN_NOTICES]?
[CURRENT_INPUT]
```

It never contains `MEMBER_IDENTITY`. ContextManifest freezes and reproduces this dynamic payload,
not the complete Runtime input produced by combining it with a first-payload Bootstrap.

<a id="adr-0100-stable-components-and-latest-identity-have-different-lifecycles"></a>
#### Stable components and latest identity have different lifecycles

Native Session Bootstrap Evidence continues to persist and reuse the original Session Charter,
original Memory Entrypoint, observed Memory revisions, authorization basis, delivery mode and their
existing component evidence. It stores no Bootstrap-scoped Member Identity Blob, Revision, digest,
version or historical snapshot; AgentProfile optimistic concurrency remains unchanged.

At each eligible Bootstrap delivery Core reads the six current AgentProfile fields once and formats
the complete Bootstrap in memory. “Latest” means the latest committed values visible to that
database read. Core releases its database lock before invoking the external Runtime; an Identity
Update committed after the read applies at the next eligible delivery and does not restart or
rewrite the invocation already in progress.

For a new Native Session, Core composes the current Session Charter, latest Member Identity and the
new Session's current Memory Entrypoint. For a Resume, Core composes the original Session Charter,
latest Member Identity and original Memory Entrypoint. A missing, unreadable or invalid identity
fails closed before Runtime creation or Resume; Core never omits the section, substitutes empty
identity or falls back to an AgentRun or earlier Session snapshot.

<a id="adr-0100-runtime-delivery-matrix"></a>
#### Runtime delivery matrix

Every Runtime receives the complete Bootstrap when Rovai-ai creates a new Native Session.

Claude Code and Codex are the only Runtime-specific Resume reinjection paths in this decision:

- Claude Code creation uses `--session-id <id> --append-system-prompt <bootstrap>` and Resume uses
  `--resume <id> --append-system-prompt <bootstrap>`;
- Codex `thread/start` and `thread/resume` both carry
  `developerInstructions: <bootstrap>`.

Other Runtimes keep their existing delivery semantics. A `first_payload` Runtime receives the
Bootstrap before the dynamic context in the first payload of a new Session and receives only the
ordinary dynamic context on Resume. An Identity Update therefore reaches Claude Code and Codex at
their next creation or Resume, while it reaches other Runtimes at their next new Session.

If a Resume failure causes a replacement Native Session, replacement follows new-Session semantics
and independently reads the latest committed identity. A controlled Resume failure that defers
replacement leaves the next execution on the existing New Session path. No path pushes identity
into an already running Runtime.

<a id="adr-0100-the-complete-bootstrap-is-intentionally-not-evidence"></a>
#### The complete Bootstrap is intentionally not evidence

The complete formatted Bootstrap and complete first payload are transient delivery values. Rovai-ai
does not persist their bytes or a digest that incorporates Member Identity. A Bootstrap Evidence
digest proves only the persisted Session Charter and Memory Entrypoint components and must not be
described as the digest of the complete prompt delivered to a Runtime.

For `first_payload`, ContextManifest stores only the exact AgentRun Dynamic Context. At new-Session
dispatch Core transiently concatenates the formatted Bootstrap and that frozen dynamic payload.
The Runtime acceptance can prove that Rovai-ai completed the delivery operation, but the retained
evidence cannot reconstruct or prove the exact Member Identity bytes included in it.

This is a deliberate loss of byte-identical complete-Bootstrap recovery in exchange for reading
current identity without storing identity history. Session Charter, Memory Entrypoint and dynamic
AgentRun input retain their own existing evidence and authority.

<a id="adr-0100-contract-break"></a>
#### Contract break

The model-visible and evidence contracts advance together to Native Session Bootstrap v2,
Bootstrap Formatter v2, Context Formatter v6 and ContextManifest v5. Member Identity remains schema
version 1. Native Binding compatibility includes the new context contract so pre-v0.35 Sessions
and unfinished Contexts are not executed through a legacy formatter or translation branch.

<a id="adr-0100-peer-privacy-remains-unchanged"></a>
#### Peer privacy remains unchanged

Another Member in the same Camp receives only stable routing identity, Name, Team Role and
Professional Responsibilities through Collaboration State. Personality
Traits, Working Principles and Growth Topic remain private to the owning Member's
`MEMBER_IDENTITY` Bootstrap projection and do not enter public Camp messages through this
projection.

This ADR supersedes ADR-0085 in full while preserving its six-field aggregate, independent update,
peer privacy and no-authority/no-Memory-side-effect rules. It locally replaces ADR-0067's
two-section Bootstrap shape, complete immutable Bootstrap bytes, Profile-independent recovery and
dynamic-context identity clauses; ADR-0067's remaining Charter, Memory, Context Read Marker,
collaboration and dynamic input contracts continue to apply.

<a id="adr-0100-consequences"></a>
### Consequences

- Member Identity stops consuming every AgentRun Dynamic Context and no longer belongs to frozen
  AgentRun configuration.
- Claude Code and Codex can receive later identity edits without rotating their Native Sessions,
  subject to each Runtime's actual upstream Resume behavior.
- Other Runtimes retain their current delivery integration and see a changed identity only in a new
  Session.
- Core must keep stable Bootstrap component evidence separate from transient full-Bootstrap
  formatting and must not accidentally persist identity through a combined first-payload Blob.
- Exact post-hoc reconstruction of the complete prompt is impossible by design; audit language and
  read models must not overclaim it.
- A context-contract migration and adapter request regression tests are required, but no legacy
  formatter or historical Resume compatibility path is required.

<a id="adr-0100-rejected-alternatives"></a>
### Rejected Alternatives

- Keep identity frozen in each AgentRun: preserves reproducibility but repeats personal context and
  applies stale identity at eligible Resume boundaries.
- Persist a Member Identity Blob, Revision, digest or Bootstrap snapshot: restores exact evidence
  by creating the identity history this decision intentionally rejects.
- Rotate every Native Session after an Identity Update: discards useful continuity and makes a
  profile edit an expensive Runtime lifecycle operation.
- Push identity immediately into a running Runtime: introduces a live update protocol and races
  with in-flight model work.
- Reinject Bootstrap on every other Runtime Resume through its ordinary input: changes their
  current delivery semantics and is outside this decision.
- Detect or work around Codex ignoring changed developer instructions on Resume: Rovai-ai still
  sends the requested value, while upstream application behavior remains outside this version.

<a id="adr-0100-references"></a>
### References

- [v0.35 Native Session Member Identity Bootstrap](README.md)
- [ADR-0067: Native Session Bootstrap and AgentRun Context v3](../v0.21/decisions.md#adr-0067)
- [ADR-0068: Brokered Memory Retrieval and Session Entrypoint](../v0.21/decisions.md#adr-0068)
- [ADR-0085: Run-Frozen Six-Field Member Identity Context](../v0.27/decisions.md#adr-0085)
- [ADR-0071: Configured Camp Creation and Lazy Conversations](../v0.22/decisions.md#adr-0071)
<!-- legacy-adr-body:end id=ADR-0100 -->
<!-- legacy-adr:end id=ADR-0100 -->
