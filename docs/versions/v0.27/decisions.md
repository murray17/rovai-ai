---
document_type: version-decisions
version: v0.27
lifecycle: historical
last_updated: 2026-08-18
---

# v0.27 决策记录

本文件按来源版本聚合迁移前的数字 ADR，保存当时的背景、选择、后果与被拒绝方案。它是历史理由来源，不是当前系统规范真源；当前规范从 [文档导航](../../README.md) 进入。

## 历史 ADR 索引

| 历史 ID | 决策 | 迁移时状态 |
| --- | --- | --- |
| [ADR-0085](#adr-0085) | Run-Frozen Six-Field Member Identity Context | `superseded` |
| [ADR-0086](#adr-0086) | Single Current Built-In Member Appearance Set | `accepted` |

<!-- legacy-adr:begin id=ADR-0085 source-file-sha256=acd504b0a1edc6d35eb899f228e9f78aa4aad184f9ff2fc616421977e50ac21c -->
<a id="adr-0085"></a>

## ADR-0085: Run-Frozen Six-Field Member Identity Context

迁移时原路径：`docs/adr/0085-run-frozen-six-field-member-identity-context.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0085
title: "Run-Frozen Six-Field Member Identity Context"
status: superseded
date: 2026-07-31
decision_scope: cross-version
source_version: v0.27
supersedes: []
superseded_by: ADR-0100
```

<!-- legacy-adr-body:begin id=ADR-0085 -->
> 本决策已由
> [ADR-0100](../v0.35/decisions.md#adr-0100) 完整替代。ADR-0100
> 保留六字段聚合、独立更新、Peer 隐私和无权限/Memory 副作用规则，但把身份从冻结的
> AgentRun Dynamic Context 迁入启动时临时格式化的 Native Session Bootstrap。

<a id="adr-0085-context"></a>
### Context

AgentProfile currently spreads long-lived identity across role title, persona label, role
description and member instructions. Session Charter then mixes live Profile name and role with
Run-frozen description and instructions. A Profile edit can therefore change one Run partially,
while ADR-0067's alternative of rotating the Native Session for material identity changes discards
useful Conversation continuity.

The product needs six distinct editable identity fields, deterministic Run recovery, immediate use
by later requests in an existing Camp, and no hidden authority or Memory side effects.

<a id="adr-0085-decision"></a>
### Decision

<a id="adr-0085-six-fields-form-one-identity-aggregate"></a>
#### Six fields form one identity aggregate

Member identity consists of Name, Team Role, Professional Responsibilities, ordered Personality
Traits, Working Principles and Growth Topic. An Identity Update validates and atomically saves
exactly these six fields under AgentProfile optimistic concurrency. Avatar, Runtime/model/native
permissions, Presence and Memory Capability remain independent mutations and UI save boundaries.

Every AgentRun freezes the complete current six-field Member Identity Snapshot when that Run is
created. A queued, waiting, running or recovering Run never rereads live Profile identity. A
successful later Identity Update affects only AgentRuns created after that commit.

<a id="adr-0085-editable-identity-is-agentrun-dynamic-context"></a>
#### Editable identity is AgentRun dynamic context

Session Charter contains the stable Core-owned authority and collaboration contract, not editable
Member identity. Every AgentRun Dynamic Context contains one required `MEMBER_IDENTITY`
personal-information section carrying that Run's frozen six-field snapshot to that Member only.
It has no Session-level accepted digest or delivery cursor. ContextManifest recovery reuses the
exact frozen section rather than rebuilding it from the latest Profile.

An Identity Update is not a Native Session compatibility change and never rotates or resets the
Session. A new Camp still receives a new Conversation and Native Session lazily when that Member
first becomes an execution target, as required by ADR-0071. Later Runs in an existing Camp reuse
the compatible Session and receive changed identity through dynamic context.

<a id="adr-0085-peers-receive-only-collaboration-identity"></a>
#### Peers receive only collaboration identity

Another Member in the same Camp receives only stable routing identity, Name, Team Role,
Professional Responsibilities and advisory availability in Collaboration State. Personality
Traits, Working Principles and Growth Topic remain private to the owning Member's
`MEMBER_IDENTITY` section and never enter public Camp messages through this projection.

Identity fields grant no Capability, permission, approval, routing authority or proof of completed
work. Growth Topic is context only: saving it creates no Memory, background job, growth log or
score. An Agent may still use the existing bounded `memory.write` contract when real collaboration
produces a legal durable Memory; changing Growth Topic never mutates existing Memory.

<a id="adr-0085-consequences"></a>
### Consequences

- Profile edits take effect on a precise AgentRun creation boundary without sacrificing Native
  Session continuity.
- Every Run and recovery path has one reproducible identity snapshot instead of mixing live and
  frozen fields.
- Each Run carries a bounded identity section, accepting modest repeated context in exchange for
  independent reproducibility and no Session-level identity cache.
- Session Charter becomes independent of user-editable Profile identity, partially replacing
  ADR-0067's Companion Profile and identity-rotation clauses.
- Peer collaboration remains useful without broadcasting private behavioral or growth context.

<a id="adr-0085-rejected-alternatives"></a>
### Rejected Alternatives

- Keep the four overlapping legacy fields and reinterpret their labels only in Renderer.
- Read live AgentProfile fields when a queued or recovering AgentRun starts.
- Rotate the Native Session after every identity edit.
- Keep identity in Session Charter and deliver a conflicting per-Run override.
- Broadcast all six fields to every Camp Member.
- Turn Growth Topic changes into automatic Memory writes or progress scoring.
- Save identity, avatar, Runtime and Memory Capability in one whole-Profile mutation.

<a id="adr-0085-references"></a>
### References

- [v0.27 Partner Identity Six Fields](README.md)
- [ADR-0067: Native Session Bootstrap and AgentRun Context v3](../v0.21/decisions.md#adr-0067)
- [ADR-0069: Single Effective Memory and Scope-Bounded Agent Mutation](../v0.21/decisions.md#adr-0069)
- [ADR-0071: Configured Camp Creation and Lazy Conversations](../v0.22/decisions.md#adr-0071)
<!-- legacy-adr-body:end id=ADR-0085 -->
<!-- legacy-adr:end id=ADR-0085 -->

<!-- legacy-adr:begin id=ADR-0086 source-file-sha256=ba234a1a1ef2dc26bc13eb784228b0ce3e9508ca19f1e4bb381428f689ff91eb -->
<a id="adr-0086"></a>

## ADR-0086: Single Current Built-In Member Appearance Set

迁移时原路径：`docs/adr/0086-single-current-built-in-member-appearance-set.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0086
title: "Single Current Built-In Member Appearance Set"
status: accepted
date: 2026-07-31
decision_scope: cross-version
source_version: v0.27
supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0086 -->
<a id="adr-0086-context"></a>
### Context

The four canonical Profiles need new user-approved portraits, icons and built-in identity presets.
ADR-0056 made built-in appearance references versioned so old and new packaged bytes could coexist,
but retaining the obsolete art and preset model would add a permanent compatibility branch for a
local product whose current built-ins are intentionally being replaced.

<a id="adr-0086-decision"></a>
### Decision

Rovai-ai maintains one current packaged appearance and preset for each existing closed built-in
role ID. v0.27 replaces the bytes and preset content behind the current four controlled built-in
references directly; it does not add `v2`, keep an old-art registry, or provide an old-image
fallback. Obsolete bust, glyph, portrait and preset content is deleted when it has no current
consumer.

The v0.27 data migration unconditionally resets the four canonical Profile IDs to the confirmed
new identity and corresponding current built-in reference. Other Profile rows retain their stored
`avatarRef`: managed assets remain unchanged, while any Profile that references a built-in
appearance displays the new single current art. Historical UI is not guaranteed to reproduce the
old packaged appearance.

ADR-0056's controlled-reference parsing, managed immutable compound assets, asset-first commit,
orphan retention, local image safety and backup boundaries remain effective. Appearance still
does not grant identity semantics, Capability, Runtime, permission or lifecycle state.

<a id="adr-0086-consequences"></a>
### Consequences

- The application ships and tests one built-in visual/preset set instead of parallel versions.
- Profiles using a built-in reference may visibly change after upgrade, including non-canonical
  and historical renderings; this is an accepted consequence rather than a compatibility defect.
- Managed user images remain stable because their immutable asset references and files are not
  replaced.
- A future desire for simultaneous historical built-in appearances requires a new decision rather
  than silently reintroducing version branches.

<a id="adr-0086-rejected-alternatives"></a>
### Rejected Alternatives

- Add `v2` references and retain all `v1` art and registry paths.
- Copy the locally approved art only into managed assets for the four canonical Profiles.
- Preserve old art for non-canonical Profiles while replacing it only for canonical Profiles.
- Keep obsolete preset fields or image files as unused compatibility data.

<a id="adr-0086-references"></a>
### References

- [v0.27 Partner Identity Six Fields](README.md)
- [ADR-0056: Controlled Member Avatar References and Application-Managed Local Assets](../v0.14/decisions.md#adr-0056)
<!-- legacy-adr-body:end id=ADR-0086 -->
<!-- legacy-adr:end id=ADR-0086 -->
