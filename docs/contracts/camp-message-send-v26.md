---
document_type: protocol-contract
contract: camp-message-send
version: 26
status: accepted
authority: user-first-message-atomic-invitations
source_version: v1.72
last_updated: 2026-10-08
---

# Camp Message Send v26

Inherits [v25](camp-message-send-v25.md)'s publication, Task association, receipt and idempotency semantics.
For a User inline submission to a Pending Thread, structured Member Mentions may name available outsiders under
[Pending Camp Activation v5](pending-camp-activation-v5.md). Core admits those members in the same transaction as
first publication, before resolving explicit or broadcast recipients. Rejected sends leave membership and draft
presence intact; rejected receipts remain replayable. The request and response fields are unchanged.

Active Thread publication still requires current addressable members; its Composer uses separate add-then-send
commands. Agent/System sends receive no new membership authority. Raw text and quotes are not invitation sources.
The existing structured body and current-roster Context projection remain unchanged.
