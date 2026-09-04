---
document_type: contract
contract: file-preview
version: 5
status: accepted
authority: desktop-owner-scoped-attachment-preview-wire
last_updated: 2026-09-04
---

# File Preview v5

v5 inherits [v4](file-preview-v4.md). Message-reference probing, classifiers, concrete file capabilities,
handles, refresh, watcher and system-open behavior are unchanged. This version changes only attachment actions
from a global attachment ID to the exact owner locator in [Camp Attachment v8](camp-attachment-v8.md).

```ts
type OpenFilePreviewRequest =
  | ExistingNonAttachmentRequests
  | {
      kind: 'attachment'
      campId: string
      locator: LocalAttachmentOwnerLocator
    }
```

The outer and locator Camp IDs must match. Main validates the closed locator, and Core proves that the exact ref
belongs to its Composer, Pending, Pending Edit or Message owner before returning a private desktop target.
`pending_edit` additionally requires its current edit token. Renderer never sends or receives an absolute path.

Preview, open and reveal report the current attachment availability as `available | missing | unreadable |
kind_changed | unknown`. The three exact source failures are also valid `FilePreviewErrorCode` values. Results
update only the current card and are not persisted. A non-image, an image above the existing preview byte limit,
or an unsupported in-App type may still be `available` while returning no image/Preview payload; availability is
not a classifier or an enduring capability.

Legacy and Managed attachment rows use the same locator and public result. Their storage model remains private
to Core.

## References

- [Camp Attachment v8](camp-attachment-v8.md)
- [Camp Open Projection v15](camp-open-projection-v15.md)
- [File Preview Architecture](../architecture/file-preview.md)
