---
document_type: interface-contract
contract: camp-attachment
version: 8
status: accepted
authority: user-source-attachment-reference-and-runtime-resolution
last_updated: 2026-09-04
---

# Camp Attachment v8

v8 replaces [v7](camp-attachment-v7.md) as the current contract. It changes only new Desktop user-input
attachments. Agent `rovai send --file`, Agent-produced artifacts, existing Managed v2 rows and historical
legacy rows retain their preceding contracts.

## Product model

A new user-input attachment is an owner-scoped local source reference, not an attachment asset:

```ts
type LocalAttachmentSourceRef = {
  id: string
  sourcePath: string
  displayName: string
  kind: 'file' | 'directory'
  mediaType: string | null
  observedByteSize: number | null
}
```

Core creates a canonical UUID `id`. It is stable only within the owning Draft, Pending input, Pending edit or
Message. `sourcePath` is an absolute, strict UTF-8 local path and remains Core-private. `observedByteSize` is
display metadata observed when the reference is added; it is not an integrity receipt.

The only durable owner fields are:

- `camp_composer_draft.source_attachments_json`;
- `pending_camp_input.source_attachments_json`;
- `pending_input_edit_session.working_source_attachments_json`;
- `camp_message.source_attachments_json`.

Each field is a JSON array of the closed shape above. No new user-input path writes `prepared_attachment`,
`managed_attachment`, `message_attachment` or `camp_message_attachment_ref`, and no attachment entity or
binding table is introduced.

## Ingress and weak durability

A native `File` path from `webUtils.getPathForFile` is stored directly. If Renderer supplies only bytes or a
Blob, Main writes them once to `app.getPath('temp')/rovai-<uuid><safe-extension>` and passes that path to Core.
After Core accepts the reference, Rovai does not delete that file on turn end or App exit; the operating system
owns its lifetime.

Rovai does not copy native sources into `camp-attachments`, Managed v2 or another long-term directory. It does
not hash, freeze, monitor, repair or search for a replacement. Consequently:

- later reads may observe modified bytes;
- moves, deletion, permission loss or OS Temp cleanup may make the reference unavailable;
- different AgentRuns may observe different content or fail at different times;
- history preserves display metadata and the reference, not permanent ownership of its content.

These are accepted semantics, not recovery defects.

## Public projection and owner actions

Renderer receives one storage-blind shape for source, Managed and legacy attachments:

```ts
type CampMessageAttachmentView = {
  id: string
  displayName: string
  kind: 'file' | 'directory'
  mediaType: string | null
  byteSize: number | null
  fileCount: number | null
  previewKind: 'image' | 'none'
  availability: 'unknown' | 'available' | 'missing' | 'unreadable' | 'kind_changed'
}
```

The View never contains `sourcePath` or a storage-model discriminator. Core resolves actions through an exact
owner locator:

```ts
type LocalAttachmentOwnerLocator =
  | { owner: 'composer'; campId: string; attachmentRefId: string }
  | { owner: 'pending'; campId: string; pendingInputId: string; attachmentRefId: string }
  | { owner: 'pending_edit'; campId: string; pendingInputId: string; editToken: string; attachmentRefId: string }
  | { owner: 'message'; campId: string; messageId: string; attachmentRefId: string }
```

Preview, open and reveal re-read the exact owner and validate existence, readability and unchanged kind. Their
result may update only the current Renderer card. History, Camp Open pagination and database reads project
`availability = unknown`; they do not `stat`, watch or persist availability.

## Publication and failure

Immediate publication validates each current source for existence, readability and unchanged `file | directory`
kind without hashing its contents. Failure returns `attachment_missing`, `attachment_unreadable` or
`attachment_kind_changed`, creates no Message and preserves the exact Composer Draft.

Pending publication performs the same validation. Failure leaves the head in FIFO position, sets
`state = needs_repair` and stores the exact code in `last_attempt_error_code`; later inputs cannot pass it.
Successful publication copies only the JSON array from Composer or Pending to
`camp_message.source_attachments_json`. It performs no Managed materialization.

## Runtime resolution

Core alone resolves source refs before constructing the unchanged `CURRENT_INPUT.attachments: string[]`:

```rust
resolve_source_attachments_for_run(source_refs, execution_root, run_tmp)
    -> Result<Vec<String>>
```

For each validated source, Core compares `canonical(source)` with `canonical(executionRoot)`. A contained source
returns its stored path directly. Every other source is copied with ordinary filesystem operations into the
current `ROVAI_RUN_TMP/source-attachments` and the Run-local path is returned. Copied external directories reject
nested symlinks and special nodes. Copy failure fails that AgentRun; it does not roll back the already-published
Message or materialize a durable attachment.

The resolver has no Runtime policy, Adapter capability matrix, quota, hard limit, reservation, pre-scan, catalog
or attachment-specific Temp lifecycle. Adapters know only the final string array.

## Legacy compatibility

Migration does not convert existing Prepared Draft rows or their files. A Draft with any
`prepared_attachment` must have an empty source array. It may edit text, remove its legacy attachments, send
directly or be discarded, but it cannot add a new source ref or enter the source-ref Pending path. Once all old
Prepared rows are removed, future additions use source refs.

Managed v2 continues to serve existing compatible data and Agent-produced artifacts. Renderer sees the same
storage-blind View, while Core internally chooses the legacy/Managed or source resolver.

## Complexity boundary

This change removes user attachment asset management. It must not introduce an attachment entity, relationship
table, user attachment directory, digest, ingest intent, staging/promote flow, attachment catalog, availability
monitor, Runtime policy, copy budget, quota system or new cross-cutting path-redaction framework.

## References

- [Camp Composer Draft v7](camp-composer-draft-v7.md)
- [Pending Camp Input v2](pending-camp-input-v2.md)
- [Camp Open Projection v15](camp-open-projection-v15.md)
- [File Preview v5](file-preview-v5.md)
- [Camp attachment architecture](../architecture/camp-published-attachment-view.md)
