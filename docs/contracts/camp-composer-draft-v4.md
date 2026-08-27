---
document_type: interface-contract
contract: camp-composer-draft
version: 4
status: accepted
authority: camp-composer-draft-attachment-publication
last_updated: 2026-08-20
---

# Camp Composer Draft v4

v4 replaces [v3](camp-composer-draft-v3.md). Exact revision, reply/continuation, ready attachment sendability, empty-body
persistence, recipient repair and all-or-none Draft consumption remain. It replaces synchronous View-before-message with
the unified semantic publication transaction.

An accepted exact Draft commits CampMessage, ordered `message_attachment` in `pending`, CampTurn/AgentRun facts,
Draft consumption, semantic revision, reservation and publication operation in one short transaction. The transaction
does not copy, hash or promote View files. Its persistent writer intent prevents the newly queued AgentRun from being
claimed until the operation resolves; no direct-user Delivery is required for that gate.

Projection success makes attachments available and releases scheduling. Recoverable failure preserves the committed
message and consumed Draft but keeps scheduling blocked and exposes recovery state. Terminal failure preserves the public
message/attachment with failed UI state, records tombstones and releases scheduling; the Run proceeds without Runtime
paths for failed attachments. A failed item is not silently retried under the same revision.

## References

- [Camp Composer Draft v3](camp-composer-draft-v3.md)
- [Camp Attachment v3](camp-attachment-v3.md)
- [Camp Published Attachment View v4](camp-published-attachment-view-v4.md)
