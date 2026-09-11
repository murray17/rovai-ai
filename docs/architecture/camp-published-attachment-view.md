---
document_type: architecture
architecture: camp-attachments
authority: user-source-refs-agent-managed-artifacts-and-legacy-view
status: accepted
last_updated: 2026-09-11
---

# Camp Attachments：用户 Source Refs、Agent Managed Artifacts 与 Legacy View

本架构区分三条不能混写的生命周期：Desktop 新用户输入使用弱持久 source refs；Agent 产物继续使用 Managed v2；
历史 Prepared/Message Attachment 与 Published View 只做兼容。字段和动作合同见
[Camp Attachment v9](../contracts/camp-attachment-v9.md)，旧 publication 对象见
[Camp Published Attachment View v4](../contracts/camp-published-attachment-view-v4.md)。

## 当前组件边界

```text
Desktop native path ─────────────────────┐
Desktop bytes/Blob -> OS Temp path ──────┤
                                         v
                              LocalAttachmentSourceRef[]
                                  owner JSON only
                  ┌──────────────────────┼──────────────────────┐
                  v                      v                      v
               Composer              Pending               Message
                                          |                    |
                                          └──── publish ───────┘
                                                               |
                                                               v
                                             Core source resolver
                                      host recheck -> stored source path

Agent `rovai send --file` -> existing private ingress -> Managed v2 artifact
historical Prepared/message_attachment -> existing legacy compatibility only
```

`LocalAttachmentSourceRef` is not an entity. Core generates its UUID and stores its absolute source path only inside the
owning JSON. Composer, Pending, Pending Edit and Message do not own or move the referenced physical file. The path is
public/view-private but dispatch-visible: Renderer and public/history Views do not receive it, while the target Runtime,
Agent and potentially its model Provider do through `CURRENT_INPUT.attachments`. Renderer receives only a pathless
attachment View without a storage-model discriminator. After an explicit successful source-file preview,
Main may separately issue a canonical display path under [File Preview v11](../contracts/file-preview-v11.md); Managed and
legacy internal paths remain private.

## Desktop user-input path

Preload first asks `webUtils.getPathForFile`. A real local path goes directly to Core; a pathless File/Blob is written once
under `app.getPath('temp')` and then behaves like any other source path. Core observes the current kind and display metadata,
but does not calculate content digest, freeze bytes or copy into `camp-attachments`/`.managed-v2`.

The owner array moves only through SQLite transactions:

```text
Composer -- direct accepted --> CampMessage
Composer -- Camp busy -------> Pending -- accepted head --> CampMessage
Pending -- Begin/Takeover ---> working refs -- Save ------> Pending
                                      ├────── Cancel -----> discard working refs
                                      └────── Delete -----> cancel Pending
```

Immediate and Pending publication validate only current existence, readability and unchanged file/directory kind. Immediate
failure preserves the exact Draft and creates no Message. Pending failure records the exact attachment error on the FIFO head,
marks it `needs_repair` and blocks later entries. A successful Message keeps the source refs; publication never materializes
Managed v2.

Source paths intentionally have weak durability. Later modification affects later reads; move/delete/permission loss or OS
Temp cleanup can make them unavailable. Rovai does not restore, search by name or freeze them after publication.

## Runtime projection

All Adapters continue to receive only `CURRENT_INPUT.attachments: string[]`. A single Core module loads source refs from the
trigger CampMessage and resolves them before Context formatting:

```text
stored Source Ref
  -> spawn_blocking host recheck
       fs::metadata + File::open or fs::read_dir
  -> exact stored source path
  -> CURRENT_INPUT.attachments
```

The recheck proves current existence, host readability and unchanged file/directory kind. `fs::metadata` follows a top-level
symlink; a directory is opened but its entries are not enumerated, so nested symlinks, dangling symlinks and special nodes do
not cause pre-Context rejection. Workspace and non-workspace paths use exactly the same operation. Core does not canonicalize,
compare with executionRoot, create a symlink, copy content or create `ROVAI_RUN_TMP/source-attachments`.

Host readability does not promise Runtime readability. Projection neither changes the Agent working directory nor widens
Runtime/OS permissions or read roots. A Runtime access failure is reported by its native file tool only if the Agent attempts
the read; Core adds no Runtime preflight, retry, synthetic attachment error, copy, upload or fallback. Generic Run Temp and the
exact Camp attachment root continue serving their other existing owners and are not changed by this projection.

## Read and action paths

Camp Open, timeline, around/thread/history and Agent history tools read SQLite metadata only. Source refs and Managed/legacy
rows project into one stable display shape with `availability = unknown`; they do not trigger `stat`, directory enumeration,
digest verification or background watching.

An explicit preview/open/reveal request supplies an owner locator for Composer, Pending, Pending Edit or Message. Core proves
ownership, resolves the private path and checks current existence/readability/kind. The result updates only the active Renderer
card. It is not persisted and does not turn availability into a global state system.

## Agent Managed v2 and legacy compatibility

Agent file ingress, Agent-produced artifacts and already-compatible Managed data retain the Managed v2 contract: private
staging, digest/receipt, opaque Camp payload, ordered message refs and existing cleanup/reconciliation. This lifecycle does not
apply to new Desktop user inputs.

Migration 137 leaves every existing `prepared_attachment`, physical `camp-attachments` payload, `message_attachment`,
`managed_attachment` and `camp_message_attachment_ref` unchanged. A Composer with old Prepared rows is a mutually exclusive
legacy Draft: it can edit text, remove old attachments, send directly or be discarded, but cannot accept source refs or enter
the new attachment Pending flow. Removing the last old attachment naturally returns the Draft to source-ref mode.

Legacy Published View mutation gates, generations and recovery continue only for their existing data. New user source refs
never enter them. Camp deletion still applies existing cleanup to Rovai-owned Agent/legacy data, but it never deletes referenced
native paths or OS Temp source files.

## Complexity boundary

The user path ends at `source path + owner JSON + Pending Queue + Context path projection`. It adds no attachment entity, binding table,
long-term user attachment directory, Managed materialization, digest, ingest intent, staging/promote, catalog, availability
monitor, Runtime policy, external-root grant, delivery mode, fallback, copy budget/quota or new cross-cutting
security/redaction framework.

## References

- [Camp Attachment v9](../contracts/camp-attachment-v9.md)
- [Camp Composer Draft v12](../contracts/camp-composer-draft-v12.md)
- [Pending Camp Input v3](../contracts/pending-camp-input-v3.md)
- [Camp Open Projection v17](../contracts/camp-open-projection-v17.md)
- [File Preview v5](../contracts/file-preview-v5.md)
- [Camp Published Attachment View v4](../contracts/camp-published-attachment-view-v4.md)
- [V1.40-D01](../versions/v1.40/decisions.md#v1-40-d01)
- [V1.58-D06](../versions/v1.58/decisions.md#v1-58-d06)
