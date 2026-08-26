---
document_type: interface-contract
contract: camp-composer-draft
version: 5
status: accepted
authority: camp-composer-draft-managed-attachment-v2-send
last_updated: 2026-08-27
---

# Camp Composer Draft v5

v5 replaces [v4](camp-composer-draft-v4.md). Exact revision, reply/continuation, attachment-only sendability, empty-body
persistence, recipient repair and all-or-none Draft consumption remain. New attachments now use
[Camp Attachment v6](camp-attachment-v6.md) rather than the legacy semantic-publication worker.

Prepared attachments remain private Draft storage. Send first checks the requested revision, creates a durable Managed v2
ingest intent, copies each item once through private staging and verifies its promoted final receipt. The final SQLite
transaction checks the same Draft revision and exact ordered Prepared Attachment IDs again, then atomically commits the
CampMessage, available Managed Attachments, ordered Message refs, CampTurn/AgentRun facts, Draft consumption and intent
completion.

A revision or transaction conflict leaves the current Draft unchanged and creates no public Message, Attachment ref,
AgentRun or Delivery. Promoted bytes from the rejected intent are durable cleanup work. The Draft schema gains no v2 ref
table and no Managed payload is created before Send.

The accepted transaction does not register a Published View operation or writer intent. New Run scheduling therefore
does not wait for another active Run or a Camp View generation. Formatter/Profile/Manifest wire shapes remain unchanged;
Context resolves the stable v2 path from SQLite only.

## References

- [Camp Composer Draft v4](camp-composer-draft-v4.md)
- [Camp Attachment v6](camp-attachment-v6.md)
- [Camp attachment architecture](../architecture/camp-published-attachment-view.md)
