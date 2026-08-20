---
document_type: interface-contract
contract: camp-attachment
version: 5
status: accepted
authority: camp-attachment-ingress-publication-runtime-and-desktop-open
last_updated: 2026-08-20
---

# Camp Attachment v5

v5 replaces [v4](camp-attachment-v4.md). File/directory shape, limits, canonical digest, immutable Authority, unified
publication, Runtime projection, per-Camp ingress serialization and Run tmp isolation remain unchanged. v5 adds a
Desktop-only user-open capability for Published Authority Attachments.

## Desktop open target

The Core request accepts exactly:

```ts
interface DesktopAttachmentTargetRequest {
  campId: string
  attachmentId: string
}
```

`campId` MUST be a canonical Camp ID. `attachmentId` MUST satisfy the managed Attachment identity shape. Lookup MUST
match one `message_attachment` by both `camp_id` and `id`; a `prepared_attachment`, a row from another Camp, or an
unknown identity is not an open target. `runtime_projection_state` is not a lookup predicate.

Before returning a target, Core MUST verify:

- the persisted `storage_path` is the exact managed payload below
  `<data_dir>/camp-attachments/<camp-id>/<attachment-id>/`;
- the final node is a regular file or managed directory matching `media_type`, `byte_size`, canonical digest and private
  metadata receipt;
- path traversal uses existing no-follow, single-link, volume/mount and unsupported-node rejection for the complete tree;
- the verified node kind agrees with the persisted media type and managed metadata.

Success returns only across the Core-to-Desktop-Main boundary:

```ts
interface DesktopAttachmentTarget {
  attachmentId: string
  displayName: string
  kind: 'file' | 'directory'
  mediaType: string
  path: string
  openRisk: 'normal' | 'confirm'
}
```

The target path MUST NOT enter `RovaiApi`, Renderer state, Camp Message, Context, Evidence, logs intended for UI, or
Agent output. A returned target is a point-in-time authorization; Desktop Main treats disappearance before the native
Shell call as a safe action failure, not as permission to resolve a replacement path.

## Risk classification and native action

Core owns `openRisk`. `confirm` includes at minimum executable/script content or known script extensions, `.app`, `.pkg`,
`.dmg`, `.exe` and `.msi`; classification may combine the verified node kind, normalized display leaf, stored MIME,
executable signature/shebang and current executable permission where the platform retains it. Renderer MUST NOT infer or
override risk.

Desktop Main MUST show a native warning before opening `confirm`; cancellation is a successful no-op and MUST NOT invoke
the system Shell. Accepted and normal targets use `shell.openPath(path)`. Reveal uses
`shell.showItemInFolder(path)`. `shell.openExternal(file://...)` is forbidden.

The Renderer-facing result is closed and path-free:

```ts
type AttachmentActionError = 'target_unavailable' | 'open_failed' | 'reveal_failed'

interface AttachmentOpenResult {
  opened: boolean
  error: AttachmentActionError | null
}

interface AttachmentRevealResult {
  revealed: boolean
  error: AttachmentActionError | null
}
```

Raw Core errors, `shell.openPath` error strings and local paths MUST NOT cross into Renderer. Desktop may retain private
diagnostic detail only under the existing local redaction boundary.

## Preview and Runtime projection

Published image preview reads the same verified Authority Attachment and does not require
`runtime_projection_state = available`. `pending | recovery_required | failed` continues to describe Agent Runtime View
readability only. Timeline may show that state but MUST NOT disable Authority preview/open/reveal solely because of it.
Prepared image preview remains available only to the current Composer Draft and does not grant Desktop open/reveal.

## References

- [Camp Attachment v4](camp-attachment-v4.md)
- [Camp Published Attachment View v3](camp-published-attachment-view-v3.md)
- [V1.20-D01](../versions/v1.20/decisions.md#v1-20-d01)
