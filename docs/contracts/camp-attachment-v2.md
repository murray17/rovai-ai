---
document_type: interface-contract
contract: camp-attachment
version: 2
status: accepted
authority: camp-attachment-ingress-publication-and-runtime-path
last_updated: 2026-08-20
---

# Camp Attachment v2

Camp Attachment v2 replaces [v1](camp-attachment-v1.md) as the current entry. It preserves v1 file/directory shape,
ingress traversal, limits, canonical tree digest, Renderer preview, Draft revision and Authority storage. It changes only
the Published Attachment authorization and Runtime path boundary.

## 1. Authority、Draft 与 Published

Authority remains:

```text
<data_dir>/camp-attachments/<camp-id>/<attachment-id>/<authority-safe-leaf>
```

Camp/Attachment parents remain non-enumerable, payloads immutable/read-only, and `.rovai-attachment.json` Core-private.
`prepared_attachment` is Draft-private. A successful all-or-none Camp Message transaction consumes its exact ordered set
into `message_attachment`; that commit makes each item a Published Attachment shared with the whole Camp. Message
addressing, the current Prompt, Run or Session does not narrow this scope.

No `prepared_attachment.storage_path`, `message_attachment.storage_path`, historical ContextManifest, Managed Blob,
summary or `contentDigest` is rewritten. Authority never moves into `.rovai`.

## 2. Runtime View publication

Before accepting a message with attachments, Core stages and verifies a copy of every item through
[Camp Published Attachment View v1](camp-published-attachment-view-v1.md). The message transaction may commit only after
all final View Entries exist. Draft or failed staging is never enumerable from the Camp View; partial message publication
does not exist.

Published entries have stable Runtime paths:

```text
<runtime-files-root>/camps/<camp-id>/attachments/<attachment-id>/payload/<authority-safe-leaf>
```

View directories/files are read-only (`0500/0400` on Unix), copies are new nodes, and neither symlink nor hardlink is used.
The model-visible `displayName` remains the original display value; it is not used as a path component.

## 3. PublishedAttachmentPathResolver v1

The resolver accepts only an admitted instance root, canonical Camp ID, Published Attachment ID, ready View Entry receipt
and persisted authority-safe leaf. It returns the exact absolute View payload path, the current Camp exact authorization
root and a receipt digest.

It is shared by Current Input, origin/reference/recent Shared Conversation, Gather request attachments, A2A preflight,
ContextManifest verification and Runtime launch. It never scans Authority, performs a path-prefix replacement, accepts an
arbitrary model/CLI/Manifest path or resolves a Draft row. Any disagreement in root, identity, receipt or canonical path
fails closed.

Current Input and Gather retain `attachments?: string[]`; Shared Message attachment retains
`name / mediaType / path`; ContextManifest attachment refs retain `attachmentId / path / contentDigest`. In all new
Formatter 21 / Manifest 20 objects, `path` is the resolved View path. `camp.read` and Renderer metadata still do not expose
either Authority or Runtime filesystem paths.

## 4. Inherited v1 behavior

- `kind = file | directory`, `fileCount`, `mediaType`, `byteSize` and `previewKind` wire shapes are unchanged.
- Per-Draft limits remain 10 top-level attachments, 25 MiB per regular file, 64 MiB aggregate, 2,000 files,
  4,000 descendant nodes and depth 32.
- Unicode/dotfile/empty-directory fidelity and canonical digest bytes are unchanged.
- symlink/reparse, socket, FIFO, device, unsafe Windows name, mount/volume escape and copy-time drift remain whole-item
  failures.
- Prepared removal/expiry and Camp Authority cleanup remain Rovai-owned, never touching original user files.

## References

- [Camp Attachment v1](camp-attachment-v1.md)
- [Camp Published Attachment View v1](camp-published-attachment-view-v1.md)
- [Camp Published Attachment View architecture](../architecture/camp-published-attachment-view.md)
