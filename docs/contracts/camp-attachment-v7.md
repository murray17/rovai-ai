---
document_type: interface-contract
contract: camp-attachment
version: 7
status: accepted
authority: camp-managed-attachment-v2
last_updated: 2026-08-30
---

# Camp Attachment v7

v7 replaces [v6](camp-attachment-v6.md) for the Agent CLI source-path entry point. Managed v2 storage, Composer ingress,
Camp ownership, digest/tree receipts, publication transactions, Context projection and legacy read compatibility are unchanged.

## CLI source adaptation

An Agent may pass a local file or directory readable by its Runtime to `rovai send --file`. Before the first Built-in Tool
IPC, the CLI resolves relative paths against the active lease's `executionRoot`. Parent traversal is rejected. Neither
Runtime cwd nor an overridden `ROVAI_RUN_TMP` environment variable changes the authoritative roots in the context file.

The original selected source is checked before canonicalization. Source leaf symlinks/reparse points and every linked or
special child in a directory are rejected. Paths below executionRoot/runTmp retain the existing descendant no-follow
checks; ordinary OS aliases above a source root, such as macOS `/var`, do not invalidate an otherwise regular source.
Canonical paths inside the two admitted roots pass through. Other absolute sources are privately copied under
`<runTmp>/.send-import/<requestId>/<ordinal>/<normalized-leaf>`. The source is never moved or modified. A source containing
the staging root is rejected to prevent recursive self-copy. Repeated paths that canonicalize to the same source are rejected.

The shared local snapshot module owns name normalization, no-follow opens, handle-relative directory traversal, stable
source checks, file/tree hashing, node/volume checks and copy limits. The CLI does not implement a separate `fs::copy` policy.
Whole-message metadata preflight is bounded; actual copied bytes remain bounded and Core performs its own authoritative
checks. Limits remain: 10 attachments; 25 MiB per regular file (including directory children); 64 MiB aggregate per message;
2,000 files, 4,000 descendant entries and 32 directory levels per directory. A directory is not capped at 25 MiB as a whole.

## Ownership, failure and cleanup

Each invocation creates an exclusive private staging directory and atomically promotes its entire request root without
replacement after all external snapshots succeed. Attachment order and normalized display names are preserved, including
same-named sources from different parents. Every path is converted to UTF-8 strictly; lossy path substitution is forbidden.
The original external path is not placed in IPC, domain commands, SQLite, message metadata or public errors.

Pre-IPC failure publishes nothing and removes only the invocation's owned snapshot tree. Frozen files/directories are made
removable during owned cleanup without following links. A validated final response permits immediate cleanup; uncertain
transport retains the snapshots until lease cleanup. The exact Run tmp identity is rechecked around copying/promotion and
the CLI rechecks its lease context before IPC. A rotated lease cannot authorize a public send.

Snapshots use the Runtime CLI process's existing filesystem rights. They do not add a Core broker or bypass Runtime/OS
permissions. As in v6, read-only modes reduce accidental writes by trusted same-UID Runtime programs; they are not a hostile
same-UID isolation mechanism. Core still independently derives the admitted workspace/runTmp from authenticated Run state,
rejects direct external-path IPC, copies through Managed v2 staging and re-authorizes before semantic commit.

## References

- [Camp Message Send v14](camp-message-send-v14.md)
- [Built-in Tool Transport v21](builtin-tool-transport-v21.md)
- [Camp attachment architecture](../architecture/camp-published-attachment-view.md)
