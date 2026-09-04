---
document_type: protocol-contract
contract: camp-open-projection-v15
authority: camp-open-storage-blind-attachment-projection
status: accepted
version: 15
source_version: v1.40
last_updated: 2026-09-04
---

# Camp Open Projection v15

v15 inherits [v14](camp-open-projection-v14.md) and changes only the attachment projection used by Camp Open,
history windows, around/thread/timeline reads and current message rendering.

Every source, Managed v2 and legacy attachment is projected through the same
`CampMessageAttachmentView` defined by [Camp Attachment v8](camp-attachment-v8.md). The View contains display
metadata and `availability`, but never an absolute path or `source_ref | managed_v2 | legacy_v1` discriminator.

All SQLite-backed history reads return `availability = unknown`. They do not `stat`, open or enumerate source or
managed payloads, and do not start a watcher or persist an availability result. Preview/open/reveal performs the
owner-scoped check only after an explicit user action; its result may update the current Renderer card without
changing this read model.

Open schema 6, Snapshot 34, Navigation 3 and `CURRENT_INPUT.attachments: string[]` remain unchanged. The latter
is populated by the Core Runtime resolver, not by this public history projection.

## References

- [Camp Attachment v8](camp-attachment-v8.md)
- [File Preview v5](file-preview-v5.md)
- [Camp Open Read Path](../architecture/camp-open-read-path.md)
