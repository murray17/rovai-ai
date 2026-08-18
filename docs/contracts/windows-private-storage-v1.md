---
document_type: contract
contract: windows-private-storage-v1
status: accepted
source_version: v1.05
last_updated: 2026-08-18
---

# Windows Private Storage v1

本合同拥有 Windows data-root 布局、存储准入、创建时 DACL、对象身份和长路径降级语义。决策理由见
[ADR-0213](../versions/v1.05/decisions.md#adr-0213)。

## 1. Data-root layout

```text
%LOCALAPPDATA%\Rovai AI\
├── Core\
├── Electron\User Data\
├── Electron\Session Data\
├── Logs\
└── CrashDumps\
```

`Core` contains SQLite, attachments, managed blobs, Runtime-private state, Skill Library/Projection journal and MCP
private material. Chromium cache/network state belongs only to `Electron\Session Data`. No v1.05 Core state is placed
under roaming `%APPDATA%`. An explicit acceptance `--user-data-dir=<root>` creates the same children beneath that exact
isolated root. Electron path overrides are complete before `app.ready`.

## 2. Storage admission

Core data and AgentRun workspace require all of:

```text
native Windows path
local fixed volume
NTFS
stable opened-handle volume + file identity
private ACL support
root and traversed components accepted by reparse policy
```

UNC/network, removable, WSL, non-NTFS, unsupported identity and unsafe reparse roots are rejected before sensitive state
or Runtime input. Stable blocker codes are:

```text
windows_storage.host_unsupported
windows_storage.not_local
windows_storage.not_ntfs
windows_storage.identity_unavailable
windows_storage.reparse_root_rejected
windows_storage.private_acl_invalid
windows_storage.long_path_policy_disabled
windows_storage.path_outside_tested_envelope
```

## 3. Private object creation

Named Pipe security is owned by Built-in Tool Transport v14. Filesystem objects use the same general rule through native
creation APIs:

- new sensitive file: `CreateFileW(..., CREATE_NEW, SECURITY_ATTRIBUTES, ...)`;
- new directory: `CreateDirectoryW(..., SECURITY_ATTRIBUTES)` one component at a time;
- DACL is protected and grants only the current user SID and SYSTEM the required access;
- owner, DACL, type, volume identity and reparse state are verified on existing objects;
- returned handles are non-inheritable unless the Managed Runtime Process contract explicitly lists a stdio handle;
- an unknown or unsafe existing object is not silently re-permissioned and reused.

Temporary files and journals are private at birth. Atomic-write helpers create a private sibling, flush bytes, verify the
opened identity, publish with the admitted same-volume operation and re-open the result before reporting success.

## 4. Path and long-path behavior

Security containment and deduplication use opened-handle identities and ancestry, not lowercase path keys or string
prefixes. A normalized display/search key may be case-insensitive, but it is never authorization evidence.

Electron, `rovai-core.exe` and `rovai.exe` must embed `longPathAware=true`. Startup reports the host `LongPathsEnabled`
state; the per-user installer never changes it. Qualification records a tested product path/component envelope per
binary and Runtime. Policy disabled or a path beyond that envelope yields the stable blockers above rather than a claim
of arbitrary 32K support.

## 5. Verification

The Windows release verifier extracts the manifest from all three executable images, verifies the data-root layout and
tests private creation without an exposure window. Acceptance covers spaces, Chinese user names, Unicode normalization,
per-directory case sensitivity, deep paths, replace-in-place identity changes and rejected network/removable volumes.

## References

- [ADR-0213](../versions/v1.05/decisions.md#adr-0213)
- [Windows Desktop Platform](../architecture/windows-desktop-platform.md)
- [Microsoft: File Security and Access Rights](https://learn.microsoft.com/en-us/windows/win32/fileio/file-security-and-access-rights)
- [Microsoft: Maximum Path Length Limitation](https://learn.microsoft.com/en-us/windows/win32/fileio/maximum-file-path-limitation)
