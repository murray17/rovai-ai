---
document_type: adr
id: ADR-0068
title: "Brokered Memory Retrieval and Session Entrypoint"
status: accepted
date: 2026-07-29
decision_scope: cross-version
source_version: v0.21
supersedes: [ADR-0035, ADR-0042]
superseded_by: null
---

# ADR-0068: Brokered Memory Retrieval and Session Entrypoint

## Context

The current Agent Memory read contract exposes a deterministic Markdown Projection through native
filesystem tools. This keeps Memory bodies out of prompts, but it also exposes storage layout,
depends on every Runtime having reliable path access and cannot retract a path or text that a
long-lived Native Session already observed.

v0.21 moves discovery into a Native Session Bootstrap. That index is necessarily a snapshot:
Memories can be revised, retired, forgotten or become inapplicable while the Session continues.
Rotating the Native Session for every such change would be expensive and would still not erase
model history. The supported read boundary therefore needs current authorization and explicit
cache-state reporting at the time of use.

## Decision

### Core-brokered read boundary

SQLite remains the sole Memory content authority. Agents read Memory only through the stable Team
Tool Gateway:

```text
memory.search
memory.read
```

Agents receive no supported Memory Projection root, Markdown path, SQLite location or physical
storage identifier. An internal diagnostic projection may exist, but it is neither an Agent API
nor a fallback. User export continues to be generated from authoritative SQLite state.

Every call resolves the current Native Binding, exactly one current AgentRun, execution epoch,
AgentProfile, Camp membership and Presence. Tool visibility, a cached ID or earlier authorization
does not grant current read authority.

### Relationship direction and applicable set

Relationship Memory has one immutable direction:

```text
mutual(A, B)
directed(actor → counterparty)
```

The pair identity is normalized and unordered; direction is a separate immutable attribute. The
authenticated user can manage and inspect every legal direction without the UI hiding reverse
entries.

For current Agent A in Camp C, the Agent-readable active set is:

```text
all Hearth Memory
Companion(A)
for each other present current Camp member B:
  mutual(A, B)
  directed(A → B)
```

`directed(B → A)`, retired Memory, forgotten Memory and historical Revisions are not readable.
Runtime availability does not change Relationship applicability. Removing B from the current
applicable member set removes the pair from A's current read authority even if A saw it earlier.

### Revision retrieval keys

Every readable MemoryRevision stores one to three immutable Retrieval Keys alongside its canonical
body. A new Revision supplies a complete new key set. Keys are discovery metadata, not a substitute
for the body and not an instruction.

Validation is:

```text
one key          2–24 UTF-8 bytes
all keys         no more than 48 UTF-8 bytes
normalization    trim, collapse whitespace, ASCII case-fold, deduplicate
rejected         control characters, newlines, table separators, closed generic stop-terms
```

Agent writes submit body and keys in one call; no second model call is required. User create/revise
surfaces may suggest editable keys but must support manual entry without an LLM.

### Session Memory Entrypoint

`MEMORY_ENTRYPOINT` is a bounded discovery snapshot in the immutable Native Session Bootstrap. It
uses stable Memory IDs and lists only:

```text
Hearth          Memory ID | Kind | Retrieval Keys
Companion       Memory ID | Kind | Retrieval Keys
Relationships   Counterparty | Memory ID | Kind | Retrieval Keys
```

The fixed bounds are:

```text
Hearth rows          16
Companion rows       32
Relationship rows    24
total rows           72
per Relationship pair 12
```

Hearth, Companion and each pair sort by Agreement, Preference, Lesson, then Memory ID. Relationship
counterparties use only structured relevance: current A2A source, structured current-Task
participants, current-turn participants, Default Lead and Member Order. Core does not infer
relevance from message prose. Deterministic allocation prevents one counterparty from consuming
all Relationship rows.

An omitted Memory remains discoverable through `memory.search`. A listed ID grants no future
access. The Charter states that Entrypoint is a cache and that the Agent must call `memory.read`
before relying on a listed item.

### Search

`memory.search` filters by the current applicable set before querying active current Revisions.
Its derived search layer uses SQLite FTS5 trigram tokenization and BM25, weighting Retrieval Keys
6 and body 1.

```text
query                    no more than 512 UTF-8 bytes
limit                    no more than 6 results
snippet per result       no more than 256 UTF-8 bytes
all returned snippets    no more than 2 KiB
```

Results contain Memory ID, Kind, Retrieval Keys and a short snippet. They never contain a complete
body merely because the result is short; the Agent uses `memory.read` for full current content.

### Read and cache state

`memory.read` accepts at most four stable Memory IDs and returns at most 8 KiB of complete body
text per call. It rechecks Binding, Run, epoch, Scope, Camp membership, Presence, Lifecycle and
current Revision in the read transaction.

An ID that is currently active and authorized returns the current body. If current Session
evidence recorded an older Revision, the response marks that change:

```text
active, no older evidence      current + current body
active, same known Revision    current + current body
active, newer Revision         revision_changed + latest Revision/body
retired                        inactive, no body
forgotten                      deleted, no body
no longer applicable           access_changed, no body
```

The three specific non-body stale states require proof that the ID was previously readable.
Previous-read evidence can come from this Binding generation's immutable Entrypoint or an earlier
successful `memory.search`/`memory.read` result recorded for the same generation. An unknown ID,
or an ID that is currently unreadable and was never proven readable to this generation, returns
the indistinguishable state `unavailable`. This prevents guessed IDs from becoming an existence
oracle without denying a currently authorized direct read.

`memory.read` never returns a retired, forgotten, superseded or formerly authorized body from
Bootstrap evidence, a ContextManifest, audit data, projection artifacts or an earlier Revision.
The warning is the cache-invalidation mechanism; it does not rotate or rewrite the Native Session.

### Evidence and failure

Search/Read evidence records request digest, authorization basis, requested/returned IDs,
Revision IDs, cache states and outcome. It does not duplicate complete queries, snippets or
Memory bodies. The derived FTS index is reconstructible; when it cannot be trusted, search is
temporarily unavailable rather than broadened or answered from stale data. Direct reads continue
from authoritative rows subject to all checks.

This ADR replaces ADR-0035 and ADR-0042 in full, including their supported Agent filesystem
Projection contract. It retains user-transparent Relationship direction while moving Agent
applicability enforcement to the brokered read boundary. It extends ADR-0014's stable Team Tool
Gateway with the two read tools; it does not create a second socket, connector or credential
boundary.

## Consequences

- Every supported Memory read has live authorization and an auditable Revision result independent
  of Runtime filesystem behavior.
- Entrypoint remains useful across a long Session without pretending to be current; stale,
  deleted and inaccessible entries produce explicit non-body results.
- Newly created Memory is available through search without Session rotation.
- The Gateway and SQLite search layer become availability dependencies for Agent Memory reads.
- Stable Memory IDs may remain in model history, but they cannot retrieve content after lifecycle
  or access changes.
- Retrieval Keys add authoring and validation work but provide deterministic, low-token discovery.

## Rejected Alternatives

- Keep Markdown Projection as the supported read API: leaks storage layout and cannot enforce
  current authorization at read time.
- Rotate Native Session on every Memory change: causes excessive churn and cannot erase prior
  model context.
- Trust Entrypoint rows until Session end: returns retired, deleted or no-longer-authorized data.
- Return an old body together with a stale warning: the warning does not undo the disclosure.
- Return `deleted` for every nonexistent or guessed ID: creates a Memory existence side channel.
- Inject all applicable Memory bodies in Bootstrap or every Run: creates an unbounded,
  high-priority prompt channel.
- Search before applying Scope and Presence filters: can leak snippets through ranking and result
  counts.

## References

- [v0.21 Native Session Bootstrap 与 AgentRun 动态上下文重构](../versions/v0.21/README.md)
- [ADR-0014: Stable Team Tool Gateway v2](0014-stable-team-tool-gateway-v2.md)
- [ADR-0019: Application-Global Memory Ownership](0019-application-global-memory-ownership.md)
- [ADR-0022: Immutable Memory Scope](0022-immutable-memory-scope.md)
- [ADR-0027: Memory-Domain Forgetting](0027-memory-domain-forgetting.md)
- [ADR-0047: User-Initiated Memory Export Boundary](0047-user-initiated-memory-export-boundary.md)
- [ADR-0057: Member Presence](0057-member-presence-and-retained-removal.md)
- [ADR-0035: User-Transparent, Agent-Applicable Relationship Memory](0035-user-transparent-agent-applicable-relationship-memory.md)
- [ADR-0042: Fail-Closed Memory Projection](0042-fail-closed-memory-projection.md)
