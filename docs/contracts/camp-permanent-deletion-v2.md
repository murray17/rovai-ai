---
document_type: protocol-contract
contract: camp-permanent-deletion-v2
authority: camp-permanent-deletion-command-and-runtime-cleanup
status: accepted
version: 2
last_updated: 2026-08-20
---

# Camp Permanent Deletion v2 Contract

Camp Permanent Deletion v2 replaces [v1](camp-permanent-deletion-v1.md). The command, user/exact-version authority,
blocker shape, force result, single-transaction business deletion and Renderer confirmation remain unchanged. v2 adds
journaled Camp Published Attachment View cleanup and orders Runtime fencing before the mutation gate.

## 1. Runtime and View ordering

For force deletion, Core captures exact active Runtime identities, requests stop, and force-fences the Camp Fleet before
waiting for the attachment View write gate. This prevents a Runtime read guard held for the complete Run from deadlocking
with deletion. Non-force deletion obtains the same gate and rejects through existing blockers/fencing when the Camp is not
quiescent.

While holding the gate, Core prepares `camp_delete_cleanup` with typed Camp ID, root-relative `camps/<camp-id>` target and
the current root identity. If business deletion rejects, the cleanup operation is cancelled and the previous ready View
state is restored.

## 2. Commit and cleanup

The existing Camp aggregate SQLite transaction remains the business deletion authority. Once it commits, callbacks cannot
recreate Camp-owned rows. Core then marks the cleanup journal committed, verifies the captured exact tree identity, removes
only that managed subtree without following symlink/reparse points, and deletes View receipts/operation state. Authority
`<data_dir>/camp-attachments/<camp-id>` is then removed through the separate existing attachment cleanup boundary.

A post-commit View or Authority cleanup failure does not resurrect the Camp or turn `camp.deleted` into rejection. The
journal remains recoverable on startup. Unknown names, identity mismatch, unsupported nodes or containment failure block
cleanup and are retained for diagnosis; deletion never expands to the Runtime Files Root, another Camp, workspace,
Managed Blob or external Runtime data. The idempotent command replay does not repeat business deletion.

Pending Camp discard follows the same View cleanup identity and gate; if discard is not applied, its cleanup operation is
cancelled.

## References

- [Camp Permanent Deletion v1](camp-permanent-deletion-v1.md)
- [Camp Published Attachment View v1](camp-published-attachment-view-v1.md)
- [Camp Published Attachment View architecture](../architecture/camp-published-attachment-view.md)
