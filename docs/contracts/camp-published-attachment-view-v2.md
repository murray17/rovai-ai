---
document_type: protocol-contract
contract: camp-published-attachment-view-v2
authority: camp-published-attachment-runtime-view
status: accepted
version: 2
last_updated: 2026-08-20
---

# Camp Published Attachment View v2 Contract

Camp Published Attachment View v2 replaces [v1](camp-published-attachment-view-v1.md) for new Context and Runtime
authorization. Root admission, Camp-shared authorization, layout, read-only copy, quota, publication gate, generation
fence, journal recovery and managed cleanup remain unchanged. v2 separates stable attachment semantics from the current
filesystem materialization so a controlled rebuild does not invalidate an otherwise identical frozen Context.

## 1. Stable and physical catalog axes

`camp_attachment_view` keeps two independent axes:

```text
catalogRevision / semanticCatalogDigest
    Published Attachment append semantics

generation / rootIdentityDigest / catalogDigest
    current local filesystem materialization and Host compatibility
```

Each `camp_attachment_view_entry` likewise keeps stable `publishedCatalogRevision` separately from physical
`publishedGeneration`, `entryIdentityDigest` and `publicationOperationId`. A successful publish advances both catalog
revision and physical generation. A controlled rebuild advances only the physical axis and must prove every stable Entry
field is unchanged before committing.

The canonical semantic Entry is:

```json
{
  "attachmentId": "attachment-uuid",
  "kind": "file",
  "byteSize": 42,
  "fileCount": 1,
  "directoryCount": 0,
  "nodeCount": 1,
  "contentDigest": "sha256:...",
  "rootRelativePayloadPath": "camps/rvcamp_.../attachments/attachment-uuid/payload/file.txt"
}
```

`semanticCatalogDigest` is the canonical digest of all semantic Entries sorted by attachment ID UTF-8 bytes. It never
contains an absolute root, device/inode/file ID, root or Entry identity, operation ID, physical generation, mode, DACL or
rebuild counter.

## 2. Publication staging and linearization

The v1 journal and state machine remain authoritative. Publish staging is executed as three explicit phases:

```text
short Database lock  → immutable CopyPlan + journal + quota reservation, status copying
no Database lock     → recursive copy + digest/identity verification + fsync
short Database lock  → revalidate Draft/CopyPlan and CAS copying → staged
```

The no-lock phase receives no `Database` reference. Draft revision or Authority row drift during copy returns
`draft_changed`; rollback removes only this operation's managed staging and no Camp message is accepted.

The per-Camp mutation gate, 55-second busy boundary and `generation_fenced_v1` behavior do not change. Final promote and
the short transaction that commits CampMessage, `message_attachment`, View Entry, catalog revision/generation and Draft
consumption remain the publication linearization boundary. An active or Warm Runtime may therefore continue to block a
带附件 publication by product design.

## 3. Semantic Context receipt

Every new Manifest stores `CampAttachmentViewReceiptV2`:

```json
{
  "schemaVersion": 2,
  "campId": "rvcamp_...",
  "attachmentRootRelativePath": "camps/rvcamp_.../attachments",
  "catalogRevision": 3,
  "catalogEntryCount": 4,
  "semanticCatalogDigest": "sha256:...",
  "referencedEntries": [],
  "referencedEntriesDigest": "sha256:..."
}
```

`referencedEntries` is the de-duplicated, attachment-ID-sorted semantic Entry set for final Current/origin/reference/
recent/Shared occurrences. The receipt contains no physical View identity or absolute root. Model-visible attachment
paths and mandatory `RUN_FACTS.campResources.publishedAttachmentRoot` remain exact absolute Runtime View paths; their
bytes do not change in v2.

Validation requires a ready current View, the exact Camp-relative root, `current catalogRevision >= frozen revision`,
exact stable identity for every referenced Entry, and a recomputed semantic catalog prefix through the frozen revision
matching the frozen count/digest. Thus append and semantics-preserving controlled rebuild retain the old receipt; missing,
replaced or semantically changed attachments fail closed.

## 4. Physical Runtime authorization

`RuntimeAttachmentAuthReceiptV1` is unchanged and remains physical:

```json
{
  "schemaVersion": 1,
  "campId": "rvcamp_...",
  "publishedAttachmentRoot": "/absolute/current-camp/attachments",
  "rootIdentityDigest": "sha256:...",
  "dispatchGeneration": 4,
  "catalogDigestAtDispatch": "sha256:...",
  "visibilityMode": "generation_fenced_v1",
  "compatibilityGeneration": 4,
  "manifestViewReceiptDigest": "sha256:..."
}
```

Before each new or explicitly retryable dispatch, Core validates the frozen semantic receipt, independently verifies the
current local root/Entry identities, permissions, Authority digest and physical catalog, then creates a current Auth
Receipt. Its digest remains part of `requestDigest`. A controlled rebuild may therefore preserve Context validity while
still forcing a new Host generation and a new physical Runtime authorization.

## 5. Migration 100 and compatibility

Migration 100 accepts only complete schema 54/Migration 99 state. It terminalizes old nonterminal Manifest 20/Receipt v1
execution using existing delivery/action evidence, preserves historical Manifest/Blob/Auth Receipt/ACK/Evidence bytes,
and backfills stable catalogs: an empty catalog is revision 0; a non-empty existing catalog is revision 1 and each existing
Entry has `publishedCatalogRevision = 1`. It installs Manifest 21/Receipt v2 as the only current write pairing and advances
to schema 55.

There is no receipt rewrite, digest recomputation, dual write, dispatch-time translation or downgrade reader. Historical
Manifest 20 is read-only and non-dispatchable after the clean break.

## 6. Unchanged safety and lifecycle

The v1 absolute-root admission, instance/Camp isolation, no-symlink/no-hardlink copies, `0500/0400` final permissions,
quota, stable errors, startup reconciliation, integrity failure, controlled rebuild and Camp deletion rules remain in
force. Runtime still receives only the exact current Camp `attachments` root and never the Authority root, instance root,
`camps` parent or another Camp.

## References

- [Camp Published Attachment View v1](camp-published-attachment-view-v1.md)
- [ContextManifest Evidence v21](context-manifest-evidence-v21.md)
- [Runtime Launch and Verification v11](runtime-launch-and-verification-v11.md)
- [V1.15-D06](../versions/v1.15/decisions.md#v1-15-d06)
