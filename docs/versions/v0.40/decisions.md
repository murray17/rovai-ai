---
document_type: version-decisions
version: v0.40
lifecycle: historical
last_updated: 2026-08-18
---

# v0.40 决策记录

本文件按来源版本聚合迁移前的数字 ADR，保存当时的背景、选择、后果与被拒绝方案。它是历史理由来源，不是当前系统规范真源；当前规范从 [文档导航](../../README.md) 进入。

## 历史 ADR 索引

| 历史 ID | 决策 | 迁移时状态 |
| --- | --- | --- |
| [ADR-0106](#adr-0106) | Agent-Bounded Cross-Camp Public History Retrieval | `accepted` |
| [ADR-0108](#adr-0108) | Discovery-Only Camp Message Search and Sequence-Paged Reads | `accepted` |
| [ADR-0109](#adr-0109) | Project-Visible Bundled Skill Sources | `superseded` |
| [ADR-0110](#adr-0110) | Internal Agent UUID and Monotonic Short Agent ID | `accepted` |

<!-- legacy-adr:begin id=ADR-0106 source-file-sha256=143a51d3324d47dee3747d63ab9baf7371c9638e08459460496b6a323c8fe2d2 -->
<a id="adr-0106"></a>

## ADR-0106: Agent-Bounded Cross-Camp Public History Retrieval

迁移时原路径：`docs/adr/0106-agent-bounded-cross-camp-public-history-retrieval.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0106
title: "Agent-Bounded Cross-Camp Public History Retrieval"
status: accepted
date: 2026-08-05
decision_scope: cross-version
source_version: v0.40
supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0106 -->
> [ADR-0129](../v0.44/decisions.md#adr-0129) 删除 Summary 生成和
> AgentRun 摘要组成条款；本文的 Agent-bounded 跨 Camp 原始消息检索边界继续有效。

<a id="adr-0106-context"></a>
### Context

ADR-0051 deliberately derives one Camp from the current AgentRun fence and states that the Team
Gateway has no cross-Camp query. That makes current-Camp retrieval reproducible and prevents model
parameters from becoming authority, but it also prevents a long-lived Agent identity from finding
source evidence in another Camp where it is still a legitimate participant.

The application-global Memory Library provides governed, durable recognition across Camps. It is
not a complete transcript index: requiring every historical lookup to become Memory would either
discard source detail or pressure Agents to persist transient content. Conversely, allowing one
Agent to search every user-visible Camp would ignore Camp membership as the collaboration and
visibility boundary.

<a id="adr-0106-decision"></a>
### Decision

The stable Team Tool Gateway may expose an explicit read-only Cross-Camp History Search to a
currently authenticated running Agent. Its eligible target set contains only other surviving
Camps in which the same AgentProfile is currently an effective CampMember. Authorization is
derived from the Binding and current domain state, never from a model-supplied Camp ID, title,
filter or cursor.

The searchable source set is limited to original public CampMessage content. Camp-owned
Segment/Epoch Summaries remain internal context-composition material and are not model search
results or readable model items. ConversationMessage, InboxMessage, private A2A content,
Runtime-private state and execution internals are outside the search and read surface. Former
membership grants no historical access, and permanent Camp deletion leaves no retrievable history.

Each ContextManifest freezes one **Cross-Camp History Fence** in the same authoritative read
snapshot: one global public-message boundary plus an exact Camp Discovery Snapshot for every other
Camp eligible at that time. Each Camp Discovery Snapshot freezes the Camp ID, Camp Name and last
visible public activity at the boundary, falling back to Camp creation time when the Camp has no
public messages. The frozen Camp set and message boundary are maximums for that AgentRun. A Camp
joined later and a public message created after the boundary remain invisible until a later
AgentRun, even if they would be authorized under current state.

`camp.list` matches only the frozen Camp Name and, without a query, orders by frozen last visible
public activity descending with Camp ID as the deterministic tie-breaker. A later rename or new
message does not change discovery within the same AgentRun. Generic `camp.updatedAt` is not exposed
because it mixes message activity with rename, membership, Task and configuration changes; the
legacy persisted `archived` state is not promoted into the model contract or domain lifecycle.

Every search and subsequent read must revalidate the caller and target Camp eligibility before
existence, counts, snippets, ranking or bodies become observable. Live membership, Member
Presence, Camp deletion and tombstone filtering intersect with the frozen Fence and may only
remove eligibility or content; they cannot add a Camp or advance the message boundary within the
same AgentRun. Search and read results are transient tool output: they do not create or revise
Memory and do not bypass Memory Scope, Lifecycle, Forget or mutation authority.

Camp discovery and relevance search return only bounded Top-K results and expose no pagination
cursor. Stable Camp and message IDs locate subsequent reads but grant no authority.
Continuous raw history uses `camp.read` thread or timeline views against the Camp's stable message
sequence; their shared integer cursor is only an exclusive ordering boundary. Every call still
derives its maximum scope from the calling Run's current ContextManifest and live authorization
intersection.

This ADR establishes the cross-Camp authorization, temporal maximum and stable discovery view.
ADR-0108 separately owns the model-facing discovery/read split, read modes and sequence pagination.
This ADR locally replaces ADR-0051's statement that cross-Camp querying does not exist while
retaining that ADR's current-Camp safety constraints unless explicitly superseded.

<a id="adr-0106-consequences"></a>
### Consequences

- A long-lived Agent can recover raw public evidence from another Camp without first converting
  it into durable Memory.
- Camp membership remains the maximum raw-history visibility boundary; user-level visibility and
  guessed identifiers do not widen Agent access.
- Membership loss and Camp deletion revoke future retrieval even when the model retains a prior
  result or cursor.
- New membership and new messages do not become visible halfway through an AgentRun, so repeated
  search, pagination and read operate against one stable maximum scope.
- Camp renames and unrelated `updatedAt` changes do not perturb discovery or disclose post-boundary
  activity to the running Agent.
- Relevance result pagination is deliberately absent; callers refine a query or enter stable raw
  timeline reading instead of pretending a mutable rank has continuous traversal semantics.
- Summary generation remains reusable for bounded prompt composition, but the model retrieval
  surface has one source authority: original CampMessage content.
- Memory remains the only governed durable cross-Camp recognition, while explicit historical
  lookup becomes a separate audited read path.
- Core must authorize before matching and ranking, otherwise result counts and snippets become a
  cross-Camp existence oracle.

<a id="adr-0106-rejected-alternatives"></a>
### Rejected Alternatives

- Keep all cross-Camp source lookup outside Agent tools: rejected because Memory is intentionally
  selective and cannot serve as a complete evidence index.
- Search every Camp visible to the local user: rejected because user visibility is not one
  AgentProfile's Camp authority.
- Preserve access to Camps the Agent has left: rejected because a historical relationship is not
  current read authorization.
- Resolve the target Camp set from live membership on every call: rejected because joining a Camp
  would silently expand a running Agent's historical authority.
- Read messages up to each call's latest state: rejected because it creates a cross-Camp future
  message side channel and makes search-to-read pagination unstable.
- Search live Camp names or order by live `camp.updatedAt`: rejected because renames and unrelated
  Camp mutations would change a frozen Run's discovery results and leak post-boundary activity.
- Paginate Camp discovery or relevance-ranked search by offset: rejected because changing document
  sets and rankings make continuation duplicate or omit results without providing a stable reading
  order.
- Make the thread/timeline Cursor a Camp locator, content ID, snapshot token or authorization capability:
  rejected because stable IDs locate content and every call derives authority from its current
  ContextManifest.
- Include private Conversation or A2A history: rejected because those records are not public Camp
  content and have different recipients and authority.
- Return shared Summary hits or bodies through model tools: rejected because raw CampMessage IDs
  already provide stable evidence and a second readable content kind complicates discovery and
  read contracts.
- Automatically save search hits as Memory: rejected because a read cannot silently cross the
  user-governed Memory mutation boundary.

<a id="adr-0106-references"></a>
### References

- [v0.40 Camp 历史检索工具收敛](README.md)
- [ADR-0108: Discovery-Only Camp Message Search and Sequence-Paged Reads](decisions.md#adr-0108)
- [ADR-0051: Boundary-Capped Context Retrieval](../v0.12/decisions.md#adr-0051)
- [ADR-0019: Application-Global Memory Ownership](../v0.10/decisions.md#adr-0019)
- [ADR-0068: Brokered Memory Retrieval and Session Entrypoint](../v0.21/decisions.md#adr-0068)
- [Domain terminology](../../../CONTEXT.md)
<!-- legacy-adr-body:end id=ADR-0106 -->
<!-- legacy-adr:end id=ADR-0106 -->

<!-- legacy-adr:begin id=ADR-0108 source-file-sha256=67af29fc4619c0c2de5f2d3b79104e4b6c1da36c79ed3fe828b1a32a59e7e564 -->
<a id="adr-0108"></a>

## ADR-0108: Discovery-Only Camp Message Search and Sequence-Paged Reads

迁移时原路径：`docs/adr/0108-discovery-only-camp-message-search-and-sequence-paged-reads.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0108
title: "Discovery-Only Camp Message Search and Sequence-Paged Reads"
status: accepted
date: 2026-08-05
decision_scope: cross-version
source_version: v0.40
supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0108 -->
> [ADR-0129](../v0.44/decisions.md#adr-0129) 删除其余 Camp Summary
> 生成、持久化和 Core 上下文组成能力；本文的四项原始 CampMessage 检索合同继续有效。

<a id="adr-0108-context"></a>
### Context

ADR-0051 introduced five model tools that separately search messages and summaries, read one
message, read a window, read a reply thread and read a summary. The split preserves safe bounded
reads, but it makes the model choose among several retrieval mechanics after every hit. Its
relevance-search cursor also suggests that a changing BM25 result set can be traversed as a stable
collection, even though inserts or visibility changes can reorder the set between calls.

Camp-owned summaries remain valuable for bounded Core context composition, but exposing both
summary bodies and original messages through model retrieval creates two readable representations
of the same public source history. Cross-Camp access under ADR-0106 makes that surface and its
authorization cost larger.

<a id="adr-0108-decision"></a>
### Decision

The stable Team Tool Gateway exposes exactly four Camp history tools:

```text
camp.list
camp.search
history.search
camp.read
```

`camp.list` discovers other Camps by their frozen names. `camp.search` searches public message
bodies in the current Camp. `history.search` searches public message bodies across the other Camps
authorized by ADR-0106. These three operations return bounded Top-K results and never expose a
pagination cursor. A caller refines the query or enters raw reading instead of continuing an old
relevance rank. They may report that the Top-K was truncated, but do not compute an exact omitted
count: discovery is not a complete traversal or count API.

Full-text indexes may identify matching source rows, but relevance scores and corpus statistics
must be derived only after the authorized Camp set, Manifest boundary and date range have been
applied. A global FTS5 BM25 score is not valid because unauthorized Camp documents would influence
visible ordering even when their rows are filtered from the result.

Only original public CampMessage content is searchable and readable. Segment and Epoch Summaries
remain internal inputs to Core-owned context composition; they are not search hits or readable
model items. The Summary FTS index has no remaining reader and is removed without removing Summary
generation or range-based context composition. Search may internally use exact derived references
to improve ranking, but references, sender filters, Summary sources and sequence ranges are not
separate model query languages.

`camp.read` is the sole raw-read interface and has four modes:

- `item` slices one stable message body by Unicode-scalar offset;
- `around` returns one bounded, non-pageable neighborhood around a stable message anchor;
- `thread` resolves any visible message to its reply-tree root and pages within that tree;
- `timeline` pages the Camp's original message order.

Thread and timeline share one integer CampMessage sequence cursor. Explicit cursors are exclusive;
results remain ordered by sequence ascending. The cursor contains no Camp identity, content
identity, snapshot or authority. Every read supplies a Camp ID and is reauthorized independently.

Collection modes return bounded original-body prefixes so one long message cannot displace the
selected neighborhood or page. `item` is the continuation path for a long body. Historical
attachments expose bounded metadata only; internal paths, Runtime projections and attachment
content remain outside this interface.

Exact input fields, limits, cursor edges, response shapes and error codes are frozen by the source
version's [tool contract](tool-contract.md). ADR-0106 owns cross-Camp membership,
Manifest and live-revocation semantics; this ADR owns the model-facing discovery-versus-reading
split.

This ADR locally replaces ADR-0051's five-tool catalog, model-readable Summary, relevance
pagination, discovery omitted-count requirement and window/thread continuation contracts.
ADR-0051's literal-query safety, short-query bounded fallback, source-message authority, tombstone
filtering and hard response budgets survive unless the v0.40 contract explicitly narrows them.

<a id="adr-0108-consequences"></a>
### Consequences

- The model has one path from discovery to evidence: Top-K message hit, stable ID read, then
  sequence-based continuation when needed.
- Relevance algorithms may change without pretending that offsets provide a stable traversal.
- Removing Summary from the model surface eliminates a second readable history authority while
  preserving Summary's Core context-composition value.
- Around, thread and timeline can return predictable sets even when individual messages are long;
  full depth costs explicit item reads.
- Historical file access is not silently granted by a message-read permission.
- Exact sender-only or arbitrary sequence-range search is unavailable until a demonstrated need
  justifies expanding the small query surface.

<a id="adr-0108-rejected-alternatives"></a>
### Rejected Alternatives

- Keep five renamed tools: rejected because it preserves the model's post-search tool-selection
  burden without adding authority or information.
- Paginate BM25 or hybrid results by integer offset: rejected because document and visibility
  changes can duplicate or skip hits.
- Put an opaque snapshot and authorization capability inside search cursors: rejected because it
  couples relevance traversal to Run authority and duplicates ContextManifest.
- Return Summary and CampMessage as peer result kinds: rejected because original messages already
  provide stable source evidence and Summary remains an internal composition optimization.
- Make every read mode pageable: rejected because item uses body slicing and around is a bounded
  orientation view; only stable ordered collections need collection cursors.
- Return attachment storage paths: rejected because a message read must not become an ambient
  cross-Camp filesystem grant.

<a id="adr-0108-references"></a>
### References

- [v0.40 tool contract](tool-contract.md)
- [ADR-0106: Agent-Bounded Cross-Camp Public History Retrieval](decisions.md#adr-0106)
- [ADR-0051: Boundary-Capped Context Retrieval](../v0.12/decisions.md#adr-0051)
- [ADR-0050: Camp-Shared Progressive Summaries](../v0.12/decisions.md#adr-0050)
- [Domain terminology](../../../CONTEXT.md)
<!-- legacy-adr-body:end id=ADR-0108 -->
<!-- legacy-adr:end id=ADR-0108 -->

<!-- legacy-adr:begin id=ADR-0109 source-file-sha256=828b4bc507734240b7cea67db5419dcb3d217760c9d5bdbca9e877653c8a7480 -->
<a id="adr-0109"></a>

## ADR-0109: Project-Visible Bundled Skill Sources

迁移时原路径：`docs/adr/0109-project-visible-bundled-skill-sources.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0109
title: Project-Visible Bundled Skill Sources
status: superseded
date: 2026-08-05
decision_scope: cross-version
source_version: v0.40
supersedes: []
superseded_by: ADR-0144
```

<!-- legacy-adr-body:begin id=ADR-0109 -->
> Superseded by [ADR-0144](../v0.49/decisions.md#adr-0144), which retains the
> project-visible packaging rules and expands the official set with two self-contained duo grilling Skills.

<a id="adr-0109-context"></a>
### Context

ADR-0105 defined one official Skill and the Runtime-group delivery model, but the complete bundled
content lived below a generic application resource tree. That layout makes product-owned Skill
instructions harder to discover and review as first-class project source. Rovai also needs a
durable Task-scoped Git worktree workflow that can be delivered through the same managed Skill
Library without creating a separate prompt protocol.

Bundled source layout and managed runtime delivery have different roles. Repository files must be
easy to inspect and version, while an AgentRun must continue to receive an immutable managed
SkillRevision selected through an explicit Delivery Group Assignment. Merely placing a directory in
the repository must not bypass enablement, assignment, projection safety, or action authority.

<a id="adr-0109-decision"></a>
### Decision

Rovai ships exactly two official Skills:

- `rovai-memory-stewardship` (“共同记忆维护”);
- `rovai-worktree` (“隔离 Worktree”).

Official Skill names continue to use the `rovai-` prefix. Both Skills are installed enabled and
without a default Delivery Group Assignment. `rovai-worktree` binds one reusable isolated Git
worktree to a durable Task across AgentRuns; it does not grant implementation, filesystem, Git, or
cleanup authority.

The complete, reviewable source for every official Skill lives at `skills/<skill-name>/` in the
repository. Each directory contains a valid `SKILL.md`, its matching `agents/openai.yaml`, and any
future scripts, references, or assets required by that Skill. Core's bundled manifest embeds these
files from the same directories and publishes them through the existing immutable SkillRevision
installation path.

The repository directory is packaging input, not a Runtime discovery root and not the managed
Library. Runtime delivery continues to follow ADR-0105: explicit application-global Assignment,
safe project-native projection, active-Run stability, same-name shadowing, and frozen exposure
evidence. Adding or removing an official Skill requires updating the bundled manifest, project
source directory, product terminology, and installation/smoke coverage together.

This decision locally replaces only ADR-0105's “single official Skill” clause. Its official-name
prefix and all Library, Assignment, projection, safety, and presentation decisions remain active.

<a id="adr-0109-consequences"></a>
### Consequences

- Reviewers can inspect every bundled Skill directly under one first-class project directory.
- The worktree workflow uses the same user-controlled Runtime delivery mechanism as other Skills.
- Bundled Skill contents remain immutable after installation and cannot silently execute merely
  because their source exists in the repository.
- Source additions now require synchronized Rust manifest and acceptance updates; a directory alone
  is intentionally insufficient to make a Skill official.

<a id="adr-0109-rejected-alternatives"></a>
### Rejected Alternatives

- Keep official Skills under a generic resource tree: rejected because product Skill content should
  be visible and reviewable as first-class source.
- Discover repository `skills/` directly at Runtime: rejected because it bypasses immutable
  revisions, assignments, projection conflict handling, and exposure evidence.
- Inject the worktree instructions into every prompt: rejected because unsupported or unassigned
  Runtimes must not receive a hidden fallback Skill protocol.
- Drop the `rovai-` prefix: rejected to preserve the official namespace and avoid collisions with
  user-imported generic Skill names.

<a id="adr-0109-references"></a>
### References

- [ADR-0105: Runtime-Group Assigned Rovai Skill Delivery](../v0.37/decisions.md#adr-0105)
- [Skill settings UI strategy](../../../apps/desktop/.impeccable/surfaces/settings-workspace.md)
- [Domain terminology](../../../CONTEXT.md)
<!-- legacy-adr-body:end id=ADR-0109 -->
<!-- legacy-adr:end id=ADR-0109 -->

<!-- legacy-adr:begin id=ADR-0110 source-file-sha256=be11c675c00d4c3f7e86393b873754e38c1030913a01e955559a35dbe7f4637d -->
<a id="adr-0110"></a>

## ADR-0110: Internal Agent UUID and Monotonic Short Agent ID

迁移时原路径：`docs/adr/0110-internal-agent-uuid-and-monotonic-short-agent-id.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0110
title: Internal Agent UUID and Monotonic Short Agent ID
status: accepted
date: 2026-08-05
decision_scope: cross-version
source_version: v0.40
supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0110 -->
> This decision partially replaces ADR-0056's fixed readable built-in AgentProfile IDs and
> ADR-0060's Base58 Member Routing ID. Controlled avatar roles, globally unique Member Names, and
> structured Mention addressing remain in force.

<a id="adr-0110-context"></a>
### Context

Rovai previously used one `AgentProfile.id` value for SQLite identity, Core relationships, model
context, and tool routing. Built-in members used semantic values such as `agent-luoke`; user-created
members used `agent-<UUID>`. The first form coupled identity to a mutable product persona, while the
second exposed long, semantically empty values to language models. Long UUID-shaped values are
costly when repeated across team context, easier for a model to copy incorrectly, and unsuitable as
the human-readable explanation of why a member should be selected.

The existing Base58 handle does not solve this boundary. It was retained for historical textual
mentions, is not a consistent tool identity, and would introduce a second random routing namespace.
Member Name also cannot be the key because it is user-editable even though it is globally unique at
any one time.

<a id="adr-0110-decision"></a>
### Decision

<a id="adr-0110-three-identity-layers"></a>
#### Three identity layers

Every AgentProfile has exactly three current identity layers:

| Identity | Shape | Visibility | Mutability | Purpose |
|---|---|---|---|---|
| Agent UUID | canonical lowercase UUID | SQLite/Core persistence only | immutable | internal row primary key |
| Agent ID | `agent_<positive integer>` | model context, tools, Core API, audit projections | immutable | short stable routing identity |
| Member Name | user-authored text | user, model context, tools | editable, globally unique | semantic display identity |

The Agent UUID must never be serialized into public Core contracts, model prompts, Runtime tool
definitions or results, diagnostics, logs, or user-visible errors. SQLite may retain the immutable
Agent ID as a unique alternate key for domain references, but the AgentProfile row itself is keyed
by the internal UUID.

The legacy handle is no longer a current identity layer. It may remain stored only to render or
interpret historical handle-shaped text. It is not shown to users, emitted to models, accepted as a
current tool target, or used to allocate future identity.

<a id="adr-0110-monotonic-allocation-and-non-reuse"></a>
#### Monotonic allocation and non-reuse

Agent IDs match exactly `^agent_[1-9][0-9]*$`. Core owns one durable application-wide sequence and
allocates the next number in the same transaction that creates an AgentProfile. The sequence only
advances; reorder, rename, Presence changes, Camp membership changes, Runtime changes, failed Runs,
and permanent Member removal never alter or release an Agent ID.

An AgentProfile creation that rolls back before the Profile exists may roll back its sequence
increment. Once a Profile has been committed, its Agent ID is never reassigned, including after the
Profile becomes permanently removed. Backup restore preserves both assigned IDs and the next
sequence value.

The four built-in companions receive the first four IDs in stable Member Order:

| Agent ID | Built-in role | Initial Member Name |
|---|---|---|
| `agent_1` | `luoke` | 小狐狸 |
| `agent_2` | `muwa` | 小河狸 |
| `agent_3` | `mianzhi` | 咕咕 |
| `agent_4` | `qilu` | 小兔 |

Built-ins and user-created Profiles use the same ID format and allocator contract. A built-in role
does not become a domain subtype, and no behavior may be inferred from `agent_1` through `agent_4`.

<a id="adr-0110-model-and-tool-projection"></a>
#### Model and tool projection

Whenever a model must choose a member, Rovai supplies the Agent ID together with current semantic
identity rather than presenting the short ID alone:

```json
{
  "agentId": "agent_2",
  "name": "小河狸",
  "teamRole": "鉴定士",
  "professionalResponsibilities": "..."
}
```

Tools accept and return the exact Agent ID. Member selection guidance uses Name, Team Role,
Professional Responsibilities, availability, and current task needs; the numeric suffix carries no
role, rank, capability, ordering, or authority semantics. Models must not guess an Agent ID from a
name or number.

<a id="adr-0110-upgrade-and-continuity"></a>
#### Upgrade and continuity

The clean-break migration assigns `agent_1` through `agent_4` to the canonical built-ins, then
assigns later numbers to existing user-created Profiles in deterministic Member Order, creation
time, and prior-ID order. It records the legacy-to-current mapping long enough to migrate external
MCP Assignments and Camp-member Codex Home directories safely.

Relational routing references, structured Member Mentions, Camp addressing, current Tasks, Memory
scope references, Camp leadership, and current actor projections move to the new Agent IDs.
Immutable historical Run payloads and user-authored prose are not rewritten merely because they
contain an old textual identifier. Existing Native Sessions are replaced so a model cannot continue
using an obsolete routing vocabulary from private Runtime history.

Digest-bound historical qualification formats keep their sealed legacy identity vocabulary. A
compatibility adapter may translate the four current built-in Agent IDs only while writing or
verifying those historical artifacts; those aliases never become current Core, model, or tool
routing identities.

Codex Home migration preserves the same Camp/member state and native files while changing only the
member path segment and owner marker. External MCP Assignment migration changes only Agent IDs and
does not modify Server identity, transport, secret material, or enablement.

<a id="adr-0110-consequences"></a>
### Consequences

- Model/tool identifiers become short and easy to copy while Member Name and role fields carry
  semantics explicitly.
- Built-in and user-created members have one routing-ID shape without deriving identity from a
  persona name.
- A durable sequence becomes critical state and must be included in backup, migration, and
  transactional tests.
- Agent IDs reveal local creation order to models and tools. They do not reveal a UUID or grant any
  authority, but they are not intended as security tokens.
- Historical text may still contain legacy identifiers. It remains evidence, not a current routing
  contract.
- Any future desire to recycle IDs, encode role in IDs, or expose UUIDs requires a new decision.

<a id="adr-0110-rejected-alternatives"></a>
### Rejected Alternatives

- Expose UUIDs to models and tools: too long, noisy, semantically empty, and error-prone to copy.
- Keep semantic built-in IDs: couples immutable identity to mutable names and role concepts.
- Route by Member Name: rename would break stable references and historical continuity.
- Use the legacy Base58 handle: remains random and semantically empty while creating another
  namespace.
- Encode role in Agent ID: roles and responsibilities are editable and must not be inferred from a
  stable key.
- Reuse removed IDs: makes old messages, Tasks, Memory and audit evidence ambiguous.

<a id="adr-0110-references"></a>
### References

- [ADR-0056: Controlled Member Avatar References](../v0.14/decisions.md#adr-0056)
- [ADR-0060: Opaque Member Routing Identity and Globally Unique Names](../v0.16/decisions.md#adr-0060)
- [ADR-0057: Member Presence and Retained Permanent Removal](../v0.15/decisions.md#adr-0057)
- [ADR-0096: Core-Owned Structured Mentions](../v0.33/decisions.md#adr-0096)
<!-- legacy-adr-body:end id=ADR-0110 -->
<!-- legacy-adr:end id=ADR-0110 -->
