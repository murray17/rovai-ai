---
document_type: adr
id: ADR-0110
title: Internal Agent UUID and Monotonic Short Agent ID
status: accepted
date: 2026-08-05
decision_scope: cross-version
source_version: v0.40
supersedes: []
superseded_by: null
---

# ADR-0110: Internal Agent UUID and Monotonic Short Agent ID

> This decision partially replaces ADR-0056's fixed readable built-in AgentProfile IDs and
> ADR-0060's Base58 Member Routing ID. Controlled avatar roles, globally unique Member Names, and
> structured Mention addressing remain in force.

## Context

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

## Decision

### Three identity layers

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

### Monotonic allocation and non-reuse

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

### Model and tool projection

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

### Upgrade and continuity

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

## Consequences

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

## Rejected Alternatives

- Expose UUIDs to models and tools: too long, noisy, semantically empty, and error-prone to copy.
- Keep semantic built-in IDs: couples immutable identity to mutable names and role concepts.
- Route by Member Name: rename would break stable references and historical continuity.
- Use the legacy Base58 handle: remains random and semantically empty while creating another
  namespace.
- Encode role in Agent ID: roles and responsibilities are editable and must not be inferred from a
  stable key.
- Reuse removed IDs: makes old messages, Tasks, Memory and audit evidence ambiguous.

## References

- [ADR-0056: Controlled Member Avatar References](0056-controlled-member-avatar-assets.md)
- [ADR-0060: Opaque Member Routing Identity and Globally Unique Names](0060-opaque-member-routing-identity.md)
- [ADR-0057: Member Presence and Retained Permanent Removal](0057-member-presence-and-retained-removal.md)
- [ADR-0096: Core-Owned Structured Mentions](0096-core-owned-structured-mentions-and-derived-addressing.md)
