---
document_type: interface-contract
contract: pending-camp-input
version: 2
status: accepted
authority: camp-next-turn-input-source-attachments-and-editing
last_updated: 2026-09-04
---

# Pending Camp Input v2

v2 replaces [v1](pending-camp-input-v1.md). FIFO admission, Scheduler progression, edit token/revision fencing,
Reply validation, needs-repair blocking, idempotency and event-driven refresh retain v1 semantics. This version
adds source attachments without introducing an attachment entity.

## Canonical Pending intent

When a source-ref Composer Draft must queue, one SQLite transaction copies its complete send intent:

- Structured Content;
- `source_attachments_json`;
- materialized Reply/Continuation addressing intent;
- Execution Request and original User identity.

The transaction inserts `pending_camp_input`, deletes the exact Composer Draft and creates no public Message,
Turn or Run. It does not move, copy or re-own physical files. Body plus attachments, attachment-only and multiple
attachments are valid.

`PendingCampInputView.attachments` projects the stored refs through the storage-blind, pathless
`CampMessageAttachmentView` from [Camp Attachment v8](camp-attachment-v8.md), initially with
`availability = unknown`.

## Pending Edit

Beginning or taking over an edit copies the canonical Pending array into
`pending_input_edit_session.working_source_attachments_json`. `PendingInputEditSession.workingAttachments`
returns the pathless projection. The exact `pending_edit` owner locator includes campId, pendingInputId,
editToken and attachmentRefId so an attachment added during the edit can be previewed or opened before save.

The existing edit command adds two actions:

| action.type | Input and effect |
| --- | --- |
| `remove_attachment` | exact `attachmentRefId`; removes it only from working refs |
| `reorder_attachments` | exact complete ordered `attachmentRefIds`; atomically replaces working order |

Adding a file or Blob uses the separate owner-scoped source-add request and the same edit-token/revision fence.
It mutates only working refs. `save` permits an empty body when working refs are non-empty and replaces the
canonical Pending array as a whole; revision increases, state returns to `queued`, the prior error is cleared and
the edit session closes. `cancel` discards working refs, preserves the canonical Pending input and closes the
session. `delete` sets the Pending row to `cancelled`, increments revision and closes the session. Neither action
deletes native or OS Temp files.

## Publication and repair

Only the FIFO head may publish. Core validates source existence, readability and unchanged kind immediately
before the existing Message transaction. On success, it copies the JSON array to
`camp_message.source_attachments_json` and records the Pending publication in the same transaction. No Managed
v2 materialization occurs.

On source failure, the head remains in place as `needs_repair`, with exactly one of
`attachment_missing`, `attachment_unreadable` or `attachment_kind_changed` in `last_attempt_error_code`.
Subsequent inputs remain blocked. Editing and saving repaired refs returns it to `queued`; deleting it permits the
next item to progress. There is no watcher, automatic retry, background availability state or physical-file
ownership transfer.

Legacy Prepared Drafts cannot enter this flow.

## References

- [Camp Attachment v8](camp-attachment-v8.md)
- [Camp Composer Draft v7](camp-composer-draft-v7.md)
- [Composer architecture](../architecture/camp-composer-draft.md)
