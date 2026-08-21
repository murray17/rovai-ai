---
document_type: interface-contract
contract: camp-attachment
version: 3
status: accepted
authority: camp-attachment-ingress-publication-and-runtime-path
last_updated: 2026-08-20
---

# Camp Attachment v3

v3 replaces [v2](camp-attachment-v2.md). File/directory shape, limits, canonical digest, immutable Authority and
Camp-wide public authorization remain. v3 adds AgentRun-local ingress and separates public attachment existence from
Runtime availability.

## Ingress adapters

The Composer adapter adopts exact ready Prepared Attachments. The Agent adapter freezes sources admitted by
[Camp Message Send v11](camp-message-send-v11.md). Both produce the same Core-private immutable Authority descriptor and
submit it to the same publication coordinator; callers do not create View entries, reservations or operations directly.

## Public and Runtime states

Every `message_attachment` has exactly one projection state:

```text
pending            public semantic fact committed; projection queued
available          verified Runtime View Entry exists
recovery_required  projection outcome recoverable; writer intent retained
failed             terminal projection failure; public fact retained
```

`pending | recovery_required` block new Runtime admission for the Camp. Only `available` belongs to the Runtime Desired
Catalog and may be accepted by `PublishedAttachmentPathResolver`. `failed` remains visible in message/history/UI metadata
but has no Runtime path; open/preview actions that imply Runtime readability are forbidden. Terminal failure is immutable
for that operation/revision. The same bytes may appear only through a new attachment operation/revision.

## Quota and lifecycle

Effective Camp usage is materialized View bytes plus unresolved publication reservations. Success consumes the
reservation into View usage; recovery-required retains it; terminal failure releases it. Authority cleanup follows
operation ownership and never touches the original user source. Camp deletion continues to remove both Authority and
derived View through managed cleanup.

## References

- [Camp Attachment v2](camp-attachment-v2.md)
- [Camp Published Attachment View v3](camp-published-attachment-view-v3.md)
- [V1.17-D01](../versions/v1.17/decisions.md#v1-17-d01)

