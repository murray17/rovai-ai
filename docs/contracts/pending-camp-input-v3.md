---
document_type: interface-contract
contract: pending-camp-input
version: 3
status: accepted
authority: camp-next-turn-composer-document-attachments-and-editing
last_updated: 2026-09-04
---

# Pending Camp Input v3

v3 replaces [v2](pending-camp-input-v2.md). FIFO admission, Scheduler progression, edit token/revision fencing,
Reply validation, `needs_repair`, idempotency, event-driven refresh, source attachments and working attachment refs
retain v2 semantics. Canonical and edited content now use [ComposerDocument V2](camp-composer-draft-v8.md).

## Canonical Pending intent

When a source-ref Draft queues, one SQLite transaction copies its complete intent:

- normalized `ComposerDocument` V2;
- ordered `source_attachments_json`;
- materialized Reply/Continuation addressing intent;
- Execution Request and original User identity.

`PendingCampInputView.content` is the V2 document. `body` is a read-only projection from that document and current
Member Catalog, never an independently accepted value. Attachment-only input retains an empty V2 document.

Core accepts legacy top-level user-authored Structured Content arrays already stored in Pending rows and converts
them on read. Every successful Pending edit/save and every newly queued input writes only the V2 envelope. Unsupported
Core-owned public-message Segments fail explicitly; they are not discarded.

## Pending Edit

Beginning or taking over an edit keeps the canonical Pending content immutable until save and copies attachments to
the edit session's working refs as in v2. The editor initializes from `PendingCampInputView.content`; its local
Lexical state is not a Core field.

The `save` action takes:

```ts
{
  type: 'save'
  content: ComposerDocument
  replyToCampMessageId: string | null
  recipientSelectionRequired: boolean
}
```

Core validates and normalizes `content`, derives body, atomically replaces canonical Pending content and working
attachments under the existing pendingInputId/revision/editToken fence, increments revision, clears the prior error,
returns the row to `queued` and closes the edit session. Save permits an empty document when working attachments are
non-empty. Cancel/Delete and add/remove/reorder attachment behavior remain v2.

## Publication and repair

Only the FIFO head may publish. Core resolves and validates current Atom identity and source availability, then maps
V2 Text/Atoms to the existing public Structured Camp Message Content in the publication transaction. On success it
records publication and attachment refs using v2 semantics. On identity or source failure the input remains explicit;
there is no name-based rebinding, Atom deletion, plain-text downgrade or fallback to another recipient.

Source failures continue to produce exact `attachment_missing`, `attachment_unreadable` or
`attachment_kind_changed` repair states and block later items. Legacy Prepared Drafts still cannot enter the queue.

## References

- [Camp Composer Draft v8](camp-composer-draft-v8.md)
- [Camp Attachment v8](camp-attachment-v8.md)
- [Composer architecture](../architecture/camp-composer-draft.md)
