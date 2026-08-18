---
document_type: version-decisions
version: v0.52
lifecycle: historical
last_updated: 2026-08-18
---

# v0.52 决策记录

本文件按来源版本聚合迁移前的数字 ADR，保存当时的背景、选择、后果与被拒绝方案。它是历史理由来源，不是当前系统规范真源；当前规范从 [文档导航](../../README.md) 进入。

## 历史 ADR 索引

| 历史 ID | 决策 | 迁移时状态 |
| --- | --- | --- |
| [ADR-0149](#adr-0149) | Bounded Whole-History Omission Evidence | `accepted` |
| [ADR-0150](#adr-0150) | Evidence-First Agent Codebase Analysis Bundled Skill | `superseded` |

<!-- legacy-adr:begin id=ADR-0149 source-file-sha256=e8e7aa1e5ca7de5cff56ed8c62fbbcc8b39fd897ef6349fd4eeb88dbb40174fc -->
<a id="adr-0149"></a>

## ADR-0149: Bounded Whole-History Omission Evidence

迁移时原路径：`docs/adr/0149-bounded-whole-history-omission-evidence.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0149
title: Bounded Whole-History Omission Evidence
status: accepted
date: 2026-08-09
decision_scope: cross-version
source_version: v0.52
supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0149 -->
<a id="adr-0149-context"></a>
### Context

Profile v2 limits the model-visible recent public window to 15 messages. A recipient can nevertheless have an
arbitrarily large interval between its previous accepted boundary and the current boundary. ContextManifest v8
represented every message omitted by `max_public_messages` as an inline `messageIds` array. The same array was
copied into a frozen Message Delivery and later into ContextManifest Evidence, so evidence size and preflight
allocation grew linearly with the entire interval even though the model saw only a count and sequence envelope.

The exact-ID rule remains useful for bounded candidate omissions such as budget eviction and reference-closure
failures. It is not an acceptable representation for an unbounded whole-history interval.

<a id="adr-0149-decision"></a>
### Decision

ContextManifest v9 separates two omission evidence forms without changing Context Delivery Profile v2:

- `max_public_messages` is aggregate whole-history evidence containing `kind`, `reason`, `count`,
  `sequenceStart`, and `sequenceEnd`; it contains no `messageIds`;
- `history_budget`, `runtime_payload_budget`, `max_reference_chain`, `parent_unavailable`, `cycle`, and
  `tombstone` continue to carry exact `messageIds`, because their candidate sets are bounded by Profile v2 and the
  Runtime payload gate.

Core computes the whole-history aggregate in SQLite against the frozen Camp ID, previous accepted boundary,
current boundary, trigger exclusion, bounded included-message set, and bounded already-explained exact omissions.
It must not materialize the whole interval as a Rust ID vector. `sequenceStart` and `sequenceEnd` are only the
minimum/maximum envelope of the omitted set, may contain gaps, and never become an executable locator or an
authorization token.

The model-visible `omittedMessages` aggregate, message selection, ordering, Unicode-scalar limits, payload budget,
canonical `camp.read` continuation, ContextManifest exact rendered bytes, and Runtime Input Delivery accepted-ACK
authority remain unchanged. This decision locally narrows ADR-0147's rule that all exact omitted message IDs remain
in ContextManifest Evidence: exact inline IDs remain mandatory only for the bounded omission classes above.

ContextManifest v9 is a current-only clean break. Data Contract v0.52 / projection schema 28 / Migration 69
invalidates old ContextManifest, Runtime Input Delivery, Bootstrap Evidence, Binding and Native Session technical
state while preserving completed Camp, Message, Task, terminal Run and terminal Turn business history. No v8/v9
read compatibility path is retained.

<a id="adr-0149-consequences"></a>
### Consequences

Frozen Delivery and ContextManifest JSON remain bounded when a Camp accumulates thousands of messages between
accepted inputs. Audit consumers can distinguish aggregate interval omission from exact bounded-candidate omission
by shape and reason. Whole-history evidence no longer enumerates every omitted source ID, so consumers that relied
on that unbounded list must use authorized Camp history operations and the frozen count/envelope instead.

The Manifest version and Native Binding compatibility digest change, so the clean break rotates the technical
Binding/Session once. This is a contract cutover, not an identity edit and not a change to eligible Bootstrap
boundaries or accepted-ACK semantics.

<a id="adr-0149-rejected-alternatives"></a>
### Rejected Alternatives

- Keeping every whole-history ID inline was rejected because it makes evidence and frozen Delivery state
  unbounded and duplicates the same list per recipient.
- Replacing every omission class with aggregates was rejected because bounded reference and budget failures can
  retain exact IDs cheaply and those IDs provide useful audit evidence.
- Treating a sequence envelope as a `camp.read` range locator was rejected because no such canonical operation
  schema exists and the envelope may contain gaps.
- Retaining a ContextManifest v8 compatibility reader was rejected because the application is pre-release and the
  clean break explicitly removes obsolete technical delivery state.

<a id="adr-0149-references"></a>
### References

- [v0.52 overview](README.md)
- [ContextManifest Evidence v9](../../contracts/context-manifest-evidence-v9.md)
- [ADR-0147](../v0.50/decisions.md#adr-0147)
- [Context Delivery Profile v2](../../contracts/context-delivery-profile-v2.md)
<!-- legacy-adr-body:end id=ADR-0149 -->
<!-- legacy-adr:end id=ADR-0149 -->

<!-- legacy-adr:begin id=ADR-0150 source-file-sha256=e2d9b13367e437cc912a3a7f8a53cf15bfb145f52885ae47be7669ced621c3f2 -->
<a id="adr-0150"></a>

## ADR-0150: Evidence-First Agent Codebase Analysis Bundled Skill

迁移时原路径：`docs/adr/0150-evidence-first-agent-codebase-analysis-bundled-skill.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0150
title: Evidence-First Agent Codebase Analysis Bundled Skill
status: superseded
date: 2026-08-10
decision_scope: cross-version
source_version: v0.52
supersedes:
  - ADR-0144
superseded_by: ADR-0159
```

<!-- legacy-adr-body:begin id=ADR-0150 -->
<a id="adr-0150-context"></a>
### Context

Rovai's four official Skills cover memory stewardship, Task-scoped worktrees, and two self-contained duo grilling
workflows. Repeated analysis of Coding Agent and multi-Agent repositories also needs a stable product-owned method:
trace real entrypoints and state transitions, distinguish implementation facts from design claims, classify planning,
delegation, Memory, Tool, Skill, storage, middleware, permission, and recovery boundaries, and produce evidence-linked
reports without turning keyword matches into architecture conclusions.

A generic prompt is insufficient because the recurring failure is methodological rather than repository-specific.
Publishing an analysis Skill as an external dependency would also make the workflow unavailable unless users discover,
import, enable, and assign the same third-party content. The workflow must remain portable across repositories and Agent
Runtimes without granting filesystem, documentation, collaboration, or execution authority.

<a id="adr-0150-decision"></a>
### Decision

Rovai ships five official Skills:

- `analyze-agent-codebase` (“Agent 代码库分析”);
- `memory-stewardship` (“共同记忆维护”);
- `worktree` (“隔离 Worktree”);
- `grill-duo` (“双人追问”);
- `grill-duo-with-docs` (“双人追问与文档”).

Every official Skill is installed enabled and without a default Skill Group Assignment. Official identity is carried
by `origin = official`, immutable bundled source, and UI provenance rather than a product prefix in the Skill name.
Availability and assignment never grant filesystem, Git, documentation, collaboration, Tool, permission, approval,
or implementation authority.

The prefix removal is a current-only name cutover. Core strips the exact former prefix from existing official records
before publishing the current bundled Revision, preserving the official Skill ID and saved Assignments for local
development data. There is no alias, dual publication, fallback lookup, or imported-name conflict migration; prompts,
project-native directory names, manifests, and new API results use only the unprefixed names.

The complete source of every official Skill lives under `skills/<skill-name>/` and contains `SKILL.md`, matching
`agents/openai.yaml`, and every required reference. Core embeds that exact file manifest and installs it through the
immutable SkillRevision path. Repository source is packaging input, not a Runtime discovery root. Adding or removing
an official Skill requires synchronized source, Core manifest, terminology, UI copy, and smoke/acceptance updates.

`analyze-agent-codebase` is self-contained and evidence-first:

- analysis requests are read-only unless the user explicitly requests document output;
- repository instructions are followed first, while executable source, assembly, state/schema, and tests remain the
  implementation evidence used to verify explanatory documentation;
- high-level conclusions are marked `confirmed`, `inferred`, or `unknown` and cite source paths, symbols, and the
  relevant entry-to-effect call chain;
- architecture labels such as ReAct, Plan-and-Execute, sub-Agent, Memory, Tool, Skill, or middleware require behavioral
  evidence and cannot be inferred from names alone;
- full dossiers use one index plus only the applicable topic documents, while targeted questions trace only the needed
  vertical slice;
- optional Camp collaboration may split bounded evidence collection, but one primary analyst reconciles cross-domain
  conclusions, verifies returned evidence, and never treats `rovai send` acceptance as teammate completion.

The two duo Skills retain ADR-0144's self-contained content and asynchronous public A2A protocol: each works when
assigned alone, embeds the instructions needed by its partner, asks one user question at a time, does not include the
questioner's recommendation in the partner request, and neither polls nor invents a second opinion. Their generic
design inputs remain non-bundled and are not Runtime dependencies.

ADR-0105 continues to own enablement, assignment, projection, conflict, and exposure semantics, except that this ADR
replaces its `rovai-` official-name prefix rule. This ADR completely replaces ADR-0144 by retaining those duo and
project-visible packaging decisions while extending the official set and freezing the codebase-analysis workflow
boundary.

<a id="adr-0150-consequences"></a>
### Consequences

Users can assign a consistent repository-archaeology workflow to any supported Runtime without importing an external
Skill. Reports become reviewable because conclusions preserve source evidence, inference status, counter-evidence, and
unknowns. The workflow remains useful in a single-member Camp; optional collaboration improves evidence collection but
does not change result authority or asynchronous delivery semantics.

Core and UI acceptance fixtures must now expect five official Skills. The bundled reference adds immutable package
content but no executable script, Tool dependency, prompt fallback, automatic assignment, or new Runtime Capability.
Future changes to the official set must supersede this exact inventory rather than edit an accepted decision in place.
Removing the prefix changes explicit invocation and project-native projection paths in one cutover.

<a id="adr-0150-rejected-alternatives"></a>
### Rejected Alternatives

- Keep the workflow as a long prompt or Memory: rejected because it is a reusable operational method with supporting
  reference material, not a stable user preference or project fact.
- Keep the `rovai-` prefix on official names: rejected because `origin`, immutable bundled source, and UI provenance
  already distinguish official Skills, while the prefix adds noise to invocation and project-native directory names.
- Trust repository documentation as the primary analysis authority: rejected because the workflow exists to detect
  implementation drift and must trace executable behavior independently.
- Require multiple Camp members: rejected because analysis must remain available in a single-member Camp and public A2A
  delivery is asynchronous.
- Bundle a crawler or language-specific parser: rejected because repository languages and registration patterns vary,
  while the high-value reusable part is evidence judgment and vertical tracing rather than one mechanical scan.

<a id="adr-0150-references"></a>
### References

- [v0.52 overview](README.md)
- [ADR-0105: Runtime-Group Assigned Rovai Skill Delivery](../v0.37/decisions.md#adr-0105)
- [ADR-0144: Self-Contained Duo Grilling Bundled Skills](../v0.49/decisions.md#adr-0144)
- [Skill settings UI strategy](../../../apps/desktop/.impeccable/surfaces/settings-workspace.md)
- [Domain terminology](../../../CONTEXT.md)
- [`analyze-agent-codebase` source](../../../skills/analyze-agent-codebase/SKILL.md)
<!-- legacy-adr-body:end id=ADR-0150 -->
<!-- legacy-adr:end id=ADR-0150 -->
