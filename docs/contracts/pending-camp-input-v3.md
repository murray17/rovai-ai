---
document_type: interface-contract
contract: pending-camp-input
version: 3
status: accepted
authority: camp-next-turn-composer-document-attachments-and-editing
last_updated: 2026-09-11
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

Normal navigation within one Renderer window may retain a local edit snapshot without any Core mutation. Resuming
requires a fresh queue projection with the same Camp, Pending ID, canonical and base revisions, editToken, and
`recoveryRequired = false`; working attachments come from that projection. This continues the existing owned edit,
never implicitly begins or takes over one. Failed navigation retains the mounted editor. Reload/crash or a changed
owner/revision retains explicit recovery; local unsaved text is not persisted by this protocol.

## Publication and repair

Only the FIFO head may publish. Core resolves and validates current Atom identity and source availability, then maps
V2 Text/Atoms to the existing public Structured Camp Message Content in the publication transaction. On success it
records publication and attachment refs using v2 semantics. On identity or source failure the input remains explicit;
there is no name-based rebinding, Atom deletion, plain-text downgrade or fallback to another recipient.

Source failures continue to produce exact `attachment_missing`, `attachment_unreadable` or
`attachment_kind_changed` repair states and block later items. Legacy Prepared Drafts still cannot enter the queue.

## Desktop submission outcomes

`camp.pendingInputs.get({ campId, submittedInputIds?: string[] })` optionally reads the durable outcomes of
inputs submitted by the current Renderer workspace. The response's optional `submissionOutcomes` contains
one `{ pendingInputId, state, campTurnId, addressedAgentIds }` per requested ID, in request order. `state` is
`queued | needs_repair | published | cancelled | missing`; `campTurnId` is the persisted publication Turn ID
or null. `addressedAgentIds` is the published message's canonical recipient order, otherwise empty; it does
not reuse the possibly changed Default Lead or member order from queue admission. An unknown ID or an ID
belonging to another Camp returns `missing` with a null Turn ID and empty recipients. Omitted
IDs do not enumerate historical outcomes. This is a read-only Desktop projection; it exposes no private
body, edit token, Runtime context or new public event, and does not publish or retry an input.

The workspace keeps only its own successful submission receipts, including queued receipts, until their
presentation intent is consumed. Existing queue invalidations, foreground/reconnect reads and submission
changes refresh the outcomes through the same single-flight reader. A published outcome resolves the
exact Turn using the ordinary public Run projection; if that projection arrives later, the workspace
waits for it. It never infers a publication from queue disappearance, message text or the newest Run.
Cancelled/missing inputs and publications without execution retire the intent. Publication may already
have happened when the initial send receipt arrives; the durable lookup still resolves it.

Publication of a locally submitted queued input uses the same execution auto-focus rules as direct send,
including visible non-terminal Run and task-creation protection. Other windows' inputs, background A2A
and old publications create no auto-focus intent. Leaving the Camp discards these presentation receipts.

## References

- [Camp Composer Draft v8](camp-composer-draft-v8.md)
- [Camp Attachment v8](camp-attachment-v8.md)
- [Composer architecture](../architecture/camp-composer-draft.md)
