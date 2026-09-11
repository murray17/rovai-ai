---
document_type: interface-contract
contract: camp-attachment
version: 9
status: accepted
authority: user-source-attachment-live-reference-and-runtime-projection
last_updated: 2026-09-11
---

# Camp Attachment v9

v9 replaces [v8](camp-attachment-v8.md) as the current contract. It changes only the Runtime delivery of
Desktop user-input Source Attachments: every valid Source Ref is now delivered as its exact stored source path.
Agent `rovai send --file`, Agent-produced artifacts, existing Managed v2 rows and historical legacy rows retain
their preceding contracts.

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
Message. `sourcePath` is an absolute, strict UTF-8 local path. It is public/view-private but dispatch-visible:
Renderer, public messages and history Views never receive it, while the target Runtime and Agent receive the
same string in `CURRENT_INPUT.attachments`; it can therefore also be visible to the model Provider used for
that Run. `observedByteSize` is display metadata observed when the reference is added, not an integrity receipt.

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
not hash, freeze, monitor, repair or search for a replacement. A Source Attachment is a live reference, not a
snapshot, and receives no additional read-only protection. Consequently:

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

The successful file-preview result is separate from this pathless attachment View. [File Preview v11](file-preview-v11.md)
allows Main to present the opened canonical source path, while Managed/legacy storage paths remain private. The internal
Desktop target carries Core's `canShowPath` decision; it never becomes a field on this View or the durable source ref.

## Publication and failure

Immediate publication validates each current source for existence, host readability and unchanged `file | directory`
kind without hashing its contents. Failure returns `attachment_missing`, `attachment_unreadable` or
`attachment_kind_changed`, creates no Message and preserves the exact Composer Draft.

Pending publication performs the same validation. Failure leaves the head in FIFO position, sets
`state = needs_repair` and stores the exact code in `last_attempt_error_code`; later inputs cannot pass it.
Successful publication copies only the JSON array from Composer or Pending to
`camp_message.source_attachments_json`. It performs no Managed materialization.

## Runtime projection

Core loads the trigger Message's Source Refs and resolves them before constructing the unchanged
`CURRENT_INPUT.attachments: string[]`:

```rust
resolve_source_attachments_for_run(source_refs) -> Result<Vec<String>>
```

The resolver runs through the existing `spawn_blocking` boundary. In stored order, it uses `fs::metadata` and
then `File::open` for a file or `fs::read_dir` for a directory to recheck existence, host readability and unchanged
kind. `fs::metadata` follows a top-level symlink, so a Source Ref whose own path is a symlink retains that behavior.
For a directory, opening `read_dir` is the complete pre-Context check: Core does not enumerate descendants, and
nested symlinks, dangling symlinks or special nodes do not reject the attachment.

After a successful check, the resolver returns the exact stored `sourcePath` string. It does not canonicalize the
path, compare it with `executionRoot`, create a filesystem symlink, copy a file or directory, or create
`ROVAI_RUN_TMP/source-attachments`. Workspace and non-workspace paths have identical delivery semantics.

The host check does not prove that the target Runtime can read the path. Source projection does not change the
Agent working directory, grant another read root, widen OS or Runtime permissions, or add Runtime preflight. If the
Agent chooses to access an unavailable path, the Runtime's native file tool reports its own OS/permission failure.
Core does not synthesize another attachment error, retry, copy, upload or materialize a fallback; if the Agent never
accesses the path, Core does not manufacture a Runtime-read failure.

Adapters continue to know only the final ordered string array. There is no delivery mode, Runtime capability split,
external-root authorization system, snapshot mode, compatibility switch, upload/materialize fallback or
attachment-specific Temp lifecycle.

## Compatibility

Existing Source Refs immediately use v9 behavior on later Runs. No database migration rewrites their owner JSON,
and no historical ContextManifest or already-prepared Runtime input is changed.

Migration does not convert existing Prepared Draft rows or their files. A Draft with any `prepared_attachment`
must have an empty source array. It may edit text, remove its legacy attachments, send directly or be discarded,
but it cannot add a new source ref or enter the source-ref Pending path. Once all old Prepared rows are removed,
future additions use source refs.

Managed v2 continues to serve existing compatible data and Agent-produced artifacts. Renderer sees the same
storage-blind View, while Core internally retains the legacy/Managed path. Generic Run Temp, Tool output, Runtime
images, Evidence exclusion, `CampAttachmentRunAccess` and Managed/legacy attachment roots remain unchanged; Source
Attachment delivery simply no longer uses Run Temp.

## Complexity boundary

This change removes the last Source Attachment content-delivery copy. It must not introduce an attachment entity,
relationship table, user attachment directory, digest, ingest intent, staging/promote flow, attachment catalog,
availability monitor, delivery strategy, Runtime policy, external read-root grant, snapshot mode, configuration
switch, copy budget, quota system or new cross-cutting path-redaction framework.

## References

- [Camp Composer Draft v12](camp-composer-draft-v12.md)
- [Pending Camp Input v3](pending-camp-input-v3.md)
- [Camp Open Projection v17](camp-open-projection-v17.md)
- [File Preview v11](file-preview-v11.md)
- [Camp attachment architecture](../architecture/camp-published-attachment-view.md)
- [V1.58-D06](../versions/v1.58/decisions.md#v1-58-d06)
