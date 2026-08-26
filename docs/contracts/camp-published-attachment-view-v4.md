---
document_type: protocol-contract
contract: camp-published-attachment-view-v4
authority: camp-published-attachment-runtime-view
status: accepted
version: 4
last_updated: 2026-08-25
---

# Camp Published Attachment View v4 Contract

v4 replaces [v3](camp-published-attachment-view-v3.md). Root admission, immutable publication resolution,
semantic/resolved/catalog revision axes, FIFO projection, read-only copy, generation fence and
`CampAttachmentViewReceiptV2` wire remain unchanged. v4 separates a successfully published attachment's immutable
semantic history from its mutable current Runtime readability, so one missing or digest-invalid attachment does not
disable an otherwise healthy Camp.

## Semantic history and current availability

An `available` publication resolution remains immutable. Its `message_attachment`, semantic revision, resolution ledger,
historical receipt and audit evidence MUST NOT be deleted, tombstoned or rewritten merely because its current Authority
or Runtime View bytes later become unavailable.

Current Runtime availability is a separate projection:

```text
Semantic Catalog = every attachment from an immutable successful publication resolution
Runtime Desired   = message_attachment WHERE runtime_projection_state = 'available'
Physical Actual   = verified View Entries and filesystem payloads for Runtime Desired
```

For an already resolved successful publication, Core MAY transition only the affected attachment from `available` to
`recovery_required` after exact Authority type, size, digest, path or node verification fails. That state means
“semantically published but currently omitted from new Runtime input”; it does not reverse the successful resolution.
The semantic catalog and resolution ledger therefore remain append-only while the current physical catalog may contain
fewer entries.

`pending` and `recovery_required` belonging to an unresolved publication operation remain writer intent. They continue to
block new Runtime admission until that operation resolves or terminalizes. A post-publication `recovery_required` row
whose operation resolution is already `available` is not unresolved writer intent and MUST NOT block the Camp.

## Attachment-local integrity degradation

Before claiming an AgentRun, the scheduler acquires the Camp read admission and performs one full View authorization. If
verification fails, it releases that admission, obtains the bounded Camp write admission and performs one attachment-local
reconciliation attempt before retrying authorization.

Reconciliation MUST:

- verify each candidate Authority payload against its stored kind, byte size, digest and no-follow tree rules;
- rebuild healthy entries through the existing journaled whole-Camp rebuild;
- transition only invalid Authority rows from `available` to post-publication `recovery_required`;
- omit those rows from the rebuilt physical catalog, new Context attachment refs and Published Attachment Path resolution;
- commit the Camp View as `ready` when the remaining physical catalog verifies, with
  `last_error_code = camp_attachment_integrity_degraded` as a private diagnostic;
- preserve every public message, attachment row, semantic receipt, resolution entry and audit record.

The scheduler retains the successful retry's read admission and verified authorization across Claim and the full Run.
Context materialization and Runtime launch reuse that result and MUST NOT hash the View a second time. If reconciliation
or the retry cannot establish a verified ready View, dispatch remains fail closed with
`camp_attachment_view_unavailable`.

An unavailable attachment has no model-visible Runtime path. New Context/history projection MUST filter it out instead of
serializing a stale path or failing the whole materialization. Other available attachments in the same Camp remain
readable.

## Recovery

Startup reconciliation and pre-dispatch reconciliation recheck post-publication `recovery_required` rows. Core may restore
one to `available` only when the exact Authority payload again passes the stored kind, byte-size, digest and no-follow tree
verification and its publication resolution remains successful. Core then performs a controlled rebuild, restores the
same stable Published Attachment Path, advances the physical generation and clears the degradation diagnostic when no
current incident remains.

Core never repairs Authority from the derived Runtime View. Bytes that do not match the immutable Authority receipt remain
unavailable even if they are locally readable.

## Fail-closed boundaries

Attachment-local degradation does not weaken instance or containment security. Root marker/identity mismatch, foreign or
unknown root entries, symlink/reparse traversal, containment escape, unsafe database state, unresolved journals and any
rebuild that cannot safely replace the derived View remain fail closed. A corrupt View payload is never exposed: Core may
continue only after safely rebuilding it from verified Authority or omitting its invalid Authority attachment under the
rules above.

Publication copy failure before immutable resolution continues to follow v3 recovery/terminal semantics. v4 does not
reinterpret an unresolved publication as a successful empty catalog.

## Admission and compatibility

`CAMP_ATTACHMENT_VIEW_CONTRACT_VERSION = 4`. Runtime Host compatibility binds v4 in addition to Camp, Agent, exact root,
visibility mode and required generation; a v3 Host cannot be reused. The semantic receipt wire remains schema 2, and the
Runtime Attachment Auth Receipt remains schema 1.

No Data Contract migration is required. Existing `runtime_projection_state`, operation resolution, semantic catalog and
View receipt fields already represent the two axes. Startup reconciliation deterministically converts only incidents it
can prove at the existing schema.

## References

- [Camp Published Attachment View v3](camp-published-attachment-view-v3.md)
- [Camp Attachment v5](camp-attachment-v5.md)
- [Camp Published Attachment View architecture](../architecture/camp-published-attachment-view.md)
- [V1.28-D10](../versions/v1.28/decisions.md#v1-28-d10)
