---
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
---

# ADR-0128: Structured Draft-Only User Camp Message Submission

## Context

ADR-0096 established Structured Camp Message Content and exact Draft revision as the intended user
send boundary, but retained two compatibility gaps: Core could still accept body, attachment IDs and
caller-supplied addressing without a Draft revision, and messages without structured content could
still be created or read as legacy Text. The obsolete `create_camp_from_first_message` service also
kept Camp creation, membership, Runtime admission, Conversation allocation and first send in one
call despite ADR-0071 separating those responsibilities.

These reachable Core contracts make structured content and derived addressing optional in practice.

## Decision

### Exact Draft revision is the only user write entry

The user-facing send command is `SendUserCampDraftCommand` with `campId`, required
`draftRevision`, optional reply target and execution intent. Core reads the authoritative Draft,
validates its structured content and prepared attachments, derives body and addressing, then
atomically creates the message/turn/runs and consumes the exact revision.

No public user command accepts body, Prepared Attachment IDs, address mode or recipient IDs.
`MessageAddressSpec`, legacy send parameters and the user-identity legacy send function do not exist.

### Every CampMessage has structured content

Structured Camp Message Content is required storage for user, Agent and system messages. Body,
addressing, recipient indexes and semantic digest are projections. Internal Agent/system append
boundaries may accept trusted generated text or structured content, but they cannot accept Member
Mention routing or invoke the user command without a Draft.

The database rejects insertion or update of a CampMessage whose structured content is null. The
current Read Model returns non-null content and performs no Text synthesis from historical body.

### Camp creation remains separate

Configured Camp creation creates only the Camp and its selected CampMembers. It creates no first
message, Conversation, Turn or Run and performs no Runtime Readiness admission. The obsolete
first-message creation command and service are deleted rather than retained as an internal shortcut.
Lazy Conversation allocation continues under ADR-0071 when an admitted execution targets a Member.

### Current identities and format versions

Mention and Member Call fields carry Agent IDs and are named `agentId`, `senderAgentId` and
`recipientAgentId`; there is no Member ID or public AgentProfile ID. Renderer tokens use
`data-agent-id`. Model-visible formatting changes are frozen as AgentRun Context formatter version
8, with one shared Rust/TypeScript fixture.

### Clean break

The projection schema resets Rovai-owned local data containing null structured messages instead of
backfilling guessed Text segments. No dual read/write or legacy alias remains. User projects, Codex
Native Home and external Runtime state are not changed.

## Consequences

- Draft content, visible Mention identity and actual routing cannot diverge through a second command.
- Read Model consumers can treat message content as required.
- Tests that need messages must construct a structured Draft or use test-only helpers that do so.
- Existing incompatible Rovai development data is discarded at the managed reset boundary.

## Rejected Alternatives

- Keep a private-looking legacy user send: internal callers would still create a second truth source.
- Project null messages to Text: preserves an unsupported historical schema indefinitely.
- Retain first-message Camp creation for tests: makes test fixtures depend on rejected production semantics.
- Keep Member/AgentProfile ID aliases: invites new protocol fields for an identity that does not exist.

## References

- [ADR-0071: Configured Camp Creation and Lazy Conversations](0071-configured-camp-creation-and-lazy-conversations.md)
- [ADR-0080: Durable Camp Composer Draft](0080-durable-camp-composer-draft-and-atomic-attachment-consumption.md)
- [ADR-0096: Structured Mentions and Derived Addressing](0096-core-owned-structured-mentions-and-derived-addressing.md)
- [ADR-0118: Local Data Clean Break](0118-v041-local-data-clean-break-and-managed-reset-boundary.md)
- [v0.43 version scope](../versions/v0.43/README.md)
