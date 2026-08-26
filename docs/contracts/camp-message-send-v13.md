---
document_type: protocol-contract
contract: camp-message-send
authority: camp-public-a2a-managed-attachment-v2-send
status: accepted
version: 13
last_updated: 2026-08-27
---

# Camp Message Send v13 Contract

v13 replaces [v12](camp-message-send-v12.md). Input, addressing, PublicOnly, Principal attention, Task/reply, Gather,
fanout, budget, attachment-only payload and accepted result shapes remain unchanged. Agent `files` now use Managed
Attachment v2.

Before the public transaction, Core derives an idempotent ingest identity from the authenticated Binding and scoped Tool
Call identity, revalidates each workspace/`ROVAI_RUN_TMP` source, copies it once through private same-filesystem staging,
promotes it under an opaque Camp-scoped identity, and records its verified receipt. Core then re-authorizes the source
Run/Binding before the send transaction.

That transaction atomically inserts the CampMessage, available `managed_attachment` rows, ordered
`camp_message_attachment_ref` rows, all real Deliveries and the command result. It does not insert a new legacy
`message_attachment`, register a publication operation or assign an attachment projection gate. Addressed Deliveries
enter the ordinary Dispatch Pump immediately; an active source Run or another active Camp Run is never stopped, fenced or
awaited by attachment publication.

Exact replay returns the recorded Message and Delivery identities without inspecting or copying source paths again. A
failure before the semantic commit abandons the ingest and publishes nothing. Reusing an existing same-Camp v2 identity
in a later domain flow adds refs only.

## References

- [Camp Message Send v12](camp-message-send-v12.md)
- [Camp Attachment v6](camp-attachment-v6.md)
- [Message Delivery v8](message-delivery-v8.md)
