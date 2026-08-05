---
document_type: adr
id: ADR-0106
title: "Agent-Bounded Cross-Camp Public History Retrieval"
status: accepted
date: 2026-08-05
decision_scope: cross-version
source_version: v0.40
supersedes: []
superseded_by: null
---

# ADR-0106: Agent-Bounded Cross-Camp Public History Retrieval

## Context

ADR-0051 deliberately derives one Camp from the current AgentRun fence and states that the Team
Gateway has no cross-Camp query. That makes current-Camp retrieval reproducible and prevents model
parameters from becoming authority, but it also prevents a long-lived Agent identity from finding
source evidence in another Camp where it is still a legitimate participant.

The application-global Memory Library provides governed, durable recognition across Camps. It is
not a complete transcript index: requiring every historical lookup to become Memory would either
discard source detail or pressure Agents to persist transient content. Conversely, allowing one
Agent to search every user-visible Camp would ignore Camp membership as the collaboration and
visibility boundary.

## Decision

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

## Consequences

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

## Rejected Alternatives

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

## References

- [v0.40 Camp 历史检索工具收敛](../versions/v0.40/README.md)
- [ADR-0108: Discovery-Only Camp Message Search and Sequence-Paged Reads](0108-discovery-only-camp-message-search-and-sequence-paged-reads.md)
- [ADR-0051: Boundary-Capped Context Retrieval](0051-boundary-capped-context-retrieval.md)
- [ADR-0019: Application-Global Memory Ownership](0019-application-global-memory-ownership.md)
- [ADR-0068: Brokered Memory Retrieval and Session Entrypoint](0068-brokered-memory-retrieval-and-session-entrypoint.md)
- [Domain terminology](../../CONTEXT.md)
