---
document_type: adr
id: ADR-0085
title: "Run-Frozen Six-Field Member Identity Context"
status: superseded
date: 2026-07-31
decision_scope: cross-version
source_version: v0.27
supersedes: []
superseded_by: ADR-0100
---

# ADR-0085: Run-Frozen Six-Field Member Identity Context

> 本决策已由
> [ADR-0100](0100-latest-member-identity-native-session-bootstrap.md) 完整替代。ADR-0100
> 保留六字段聚合、独立更新、Peer 隐私和无权限/Memory 副作用规则，但把身份从冻结的
> AgentRun Dynamic Context 迁入启动时临时格式化的 Native Session Bootstrap。

## Context

AgentProfile currently spreads long-lived identity across role title, persona label, role
description and member instructions. Session Charter then mixes live Profile name and role with
Run-frozen description and instructions. A Profile edit can therefore change one Run partially,
while ADR-0067's alternative of rotating the Native Session for material identity changes discards
useful Conversation continuity.

The product needs six distinct editable identity fields, deterministic Run recovery, immediate use
by later requests in an existing Camp, and no hidden authority or Memory side effects.

## Decision

### Six fields form one identity aggregate

Member identity consists of Name, Team Role, Professional Responsibilities, ordered Personality
Traits, Working Principles and Growth Topic. An Identity Update validates and atomically saves
exactly these six fields under AgentProfile optimistic concurrency. Avatar, Runtime/model/native
permissions, Presence and Memory Capability remain independent mutations and UI save boundaries.

Every AgentRun freezes the complete current six-field Member Identity Snapshot when that Run is
created. A queued, waiting, running or recovering Run never rereads live Profile identity. A
successful later Identity Update affects only AgentRuns created after that commit.

### Editable identity is AgentRun dynamic context

Session Charter contains the stable Core-owned authority and collaboration contract, not editable
Member identity. Every AgentRun Dynamic Context contains one required `MEMBER_IDENTITY`
personal-information section carrying that Run's frozen six-field snapshot to that Member only.
It has no Session-level accepted digest or delivery cursor. ContextManifest recovery reuses the
exact frozen section rather than rebuilding it from the latest Profile.

An Identity Update is not a Native Session compatibility change and never rotates or resets the
Session. A new Camp still receives a new Conversation and Native Session lazily when that Member
first becomes an execution target, as required by ADR-0071. Later Runs in an existing Camp reuse
the compatible Session and receive changed identity through dynamic context.

### Peers receive only collaboration identity

Another Member in the same Camp receives only stable routing identity, Name, Team Role,
Professional Responsibilities and advisory availability in Collaboration State. Personality
Traits, Working Principles and Growth Topic remain private to the owning Member's
`MEMBER_IDENTITY` section and never enter public Camp messages through this projection.

Identity fields grant no Capability, permission, approval, routing authority or proof of completed
work. Growth Topic is context only: saving it creates no Memory, background job, growth log or
score. An Agent may still use the existing bounded `memory.write` contract when real collaboration
produces a legal durable Memory; changing Growth Topic never mutates existing Memory.

## Consequences

- Profile edits take effect on a precise AgentRun creation boundary without sacrificing Native
  Session continuity.
- Every Run and recovery path has one reproducible identity snapshot instead of mixing live and
  frozen fields.
- Each Run carries a bounded identity section, accepting modest repeated context in exchange for
  independent reproducibility and no Session-level identity cache.
- Session Charter becomes independent of user-editable Profile identity, partially replacing
  ADR-0067's Companion Profile and identity-rotation clauses.
- Peer collaboration remains useful without broadcasting private behavioral or growth context.

## Rejected Alternatives

- Keep the four overlapping legacy fields and reinterpret their labels only in Renderer.
- Read live AgentProfile fields when a queued or recovering AgentRun starts.
- Rotate the Native Session after every identity edit.
- Keep identity in Session Charter and deliver a conflicting per-Run override.
- Broadcast all six fields to every Camp Member.
- Turn Growth Topic changes into automatic Memory writes or progress scoring.
- Save identity, avatar, Runtime and Memory Capability in one whole-Profile mutation.

## References

- [v0.27 Partner Identity Six Fields](../versions/v0.27/README.md)
- [ADR-0067: Native Session Bootstrap and AgentRun Context v3](0067-native-session-bootstrap-and-agentrun-context-v3.md)
- [ADR-0069: Single Effective Memory and Scope-Bounded Agent Mutation](0069-single-effective-memory-and-scope-bounded-agent-mutation.md)
- [ADR-0071: Configured Camp Creation and Lazy Conversations](0071-configured-camp-creation-and-lazy-conversations.md)
