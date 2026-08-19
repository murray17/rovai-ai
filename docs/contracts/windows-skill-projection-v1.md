---
document_type: contract
contract: windows-skill-projection-v1
status: accepted
source_version: v1.05
last_updated: 2026-08-18
---

# Windows Skill Projection v1

本合同拥有 Windows copy backend 的 journal、发布/恢复、Execution Root Projection Gate 与删除语义。Library、
Root Access、desired state 和 SkillExposureSnapshot 继续由
[Skill Projection Reconciliation](../architecture/skill-projection-reconciliation.md)拥有。

## 1. Journal

每个 publish operation 使用私有、create-new、schema 2 journal：

```json
{
  "schemaVersion": 2,
  "operationId": "uuid",
  "rootIdentity": "volume-and-directory-file-id",
  "entryPath": "C:\\workspace\\.codex\\skills\\example",
  "stagingPath": "...",
  "backupPath": "...",
  "skillId": "...",
  "oldRevisionId": "... or null",
  "oldContentDigest": "sha256:... or null",
  "oldEntryIdentity": "volume-and-directory-file-id or null",
  "newRevisionId": "...",
  "newContentDigest": "sha256:...",
  "newEntryIdentity": "volume-and-directory-file-id",
  "state": "prepared|old_moved_to_backup|new_promoted|verified|metadata_committed|cleanup_pending|completed"
}
```

Paths are siblings under one verified parent and volume. `newEntryIdentity` is captured from the fully flushed staging
directory and must remain unchanged when staging is renamed to final; the optional old identity must likewise follow
final to backup. Every rename destination must not exist. Journal replacement is itself a private temp-write + flush +
publish operation; copied file bytes are flushed before `prepared`. A state advances only after the filesystem result has
been reopened and its identity plus digest verified.

## 2. Publish sequence

```text
copy source → sibling staging
verify complete tree + digest
persist prepared

if final exists: final → backup
verify backup identity/digest
persist old_moved_to_backup

staging → final
verify final identity
persist new_promoted

verify complete final tree + digest
persist verified

idempotently commit DB observation bound to operationId
persist metadata_committed

delete verified backup
persist cleanup_pending → completed
remove completed journal after DB audit is durable
```

Sharing violations from antivirus/indexers receive a bounded, jittered retry. Exhaustion fails closed with the journal
retained. No filesystem copy/rename/delete runs inside a long SQLite transaction.

Source and copied-tree digest verification follows the Windows Revision v1 logical-mode rule in
[Skill Projection Reconciliation](../architecture/skill-projection-reconciliation.md#windows-revision-v1-逻辑-mode):
regular files contribute logical mode `0644`, while protected DACL admission remains a separate storage proof.

## 3. Crash-window recovery

Core recovers this root before AgentRun admission. Recovery inspects journal plus opened identities/digests of final,
staging and backup and the DB observation for `operationId`:

- crash after rename but before state write is resolved from the unique verified path/digest combination;
- crash after DB commit but before `metadata_committed` is idempotently recognized by `operationId`;
- old-only state restores old final; new-only verified state completes metadata; verified old+new selects according to
  the last proven transition and never deletes either until DB authority is settled;
- same path and same content with a different NTFS volume/file identity is external replacement, not Rovai ownership;
- missing, mismatched, project-owned or externally changed evidence is `ambiguous`; the root remains closed and repair
  diagnostics preserve all paths.

Correctness must not assume that a directory rename and journal write are atomic together. Crash-injection tests cover
before and after every filesystem, journal and DB transition.

## 4. Execution Root Projection Gate

The gate is keyed by opened canonical root identity:

- launch obtains shared admission, verifies `ready`, records `agentRunId + executionEpoch + executionRoot + rootIdentity`
  in `skill_projection_run_registration`, then releases the short critical section;
- publish/recovery obtains exclusive admission; it waits until the root has no active Runs and blocks new launches;
- an active Run keeps only a registration, not a long-held filesystem lock;
- registration and projection mutation are serialized by the single Core database critical section; waiting never holds
  that mutex, so terminal settlement can unregister the old Run;
- terminal registrations are pruned only after authoritative AgentRun status/epoch proves they are no longer active;
- Core restart reuses persisted registrations, reconstructs active/recovery facts, resolves journals, then opens admission;
- ambiguous recovery leaves the root blocked with a stable `skill_projection_recovery_required` reason.

Migration 97 installs the registration table plus nullable `operation_id` and `entry_identity` observation columns and
advances the exact `v1.13 / schema 51 / migration 96` source to Data Contract `v1.15 / projection schema 52`. Existing
macOS observations remain valid with null Windows-only identity fields; Migration 96 remains the released v1.13
`agent_run.runtime_observed_model_id` transition and is never reused.

## 5. Ownership and delete

DB observation, journal/operation identity, persisted entry identity, current entry/root opened identities,
Skill/Revision identity and exact content digest must agree before replace or delete. Missing evidence, ordinary
directories, foreign links or external modifications are project-owned/drift: preserve them, record the issue and fail
closed. Runtime-visible Skill content contains no marker.

## References

- [ADR-0214](../versions/v1.05/decisions.md#adr-0214)
- [Skill Projection Reconciliation](../architecture/skill-projection-reconciliation.md)
- [Microsoft: Moving Directories](https://learn.microsoft.com/en-us/windows/win32/fileio/moving-directories)
