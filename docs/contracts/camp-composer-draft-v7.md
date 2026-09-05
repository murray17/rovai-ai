---
document_type: interface-contract
contract: camp-composer-draft
version: 7
status: accepted
authority: camp-composer-source-attachment-and-next-turn-admission
last_updated: 2026-09-04
---

# Camp Composer Draft v7

v7 replaces [v6](camp-composer-draft-v6.md). Structured Content, revision, Reply, Continuation and exact-Draft
consumption retain v6 semantics. New user attachments follow [Camp Attachment v8](camp-attachment-v8.md).

`camp_composer_draft.source_attachments_json` stores the ordered Core-private source refs. The public
`CampComposerDraftView.attachments` contains only storage-blind attachment Views; no absolute path or storage
model reaches Renderer.

A Draft is sendable when its rendered body is non-empty or its attachment View array is non-empty. Thus text
plus attachments, attachment-only and multiple-attachment sends are valid. A successful direct send copies the
source-ref JSON to `camp_message.source_attachments_json`; a successful queue admission copies it to
`pending_camp_input.source_attachments_json`. Both consume the exact Draft in their existing SQLite transaction,
and neither moves or copies the physical source.

Camp activity and queue state no longer block file selection, paste, drop or attachment submission. When Core
requires queuing, source refs enter Pending along with Structured Content, Reply/Continuation intent after its
existing materialization, and Execution Request. Rejection preserves the exact Draft.

An upgraded Draft containing legacy `prepared_attachment` rows remains a mutually exclusive legacy Draft:

- its `source_attachments_json` is empty;
- it may edit text, remove existing attachments, send directly or be discarded;
- it cannot add another Prepared attachment, add a source ref, or enter the source-ref Pending path;
- after its final Prepared row is removed, subsequent user additions use source refs.

No existing Prepared row or physical payload is migrated into a source ref. New public Desktop ingress cannot
create Prepared rows.

## References

- [Camp Attachment v8](camp-attachment-v8.md)
- [Pending Camp Input v2](pending-camp-input-v2.md)
- [Composer architecture](../architecture/camp-composer-draft.md)
