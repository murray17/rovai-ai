---
document_type: contract
contract: windows-private-storage-v2
status: accepted
source_version: v1.15
last_updated: 2026-08-20
---

# Windows Private Storage v2

Windows Private Storage v2 replaces [v1](windows-private-storage-v1.md). It preserves the v1 Desktop data-root layout,
local fixed NTFS admission, stable handle identity, protected DACL creation, non-inheritable handles and long-path blockers.
It adds the Instance Runtime Files Root as one protected Core child.

## 1. Runtime Files Root

Windows Desktop explicitly passes:

```text
--runtime-camp-files-root <data_dir>\runtime-files
```

For the default installation this is `%LOCALAPPDATA%\Rovai AI\Core\runtime-files`; explicit isolated Desktop roots use
their own `Core\runtime-files`. No attachment View is placed under user Home, roaming AppData or a shared cross-instance
directory. This exact child is the only allowed Runtime-root/data-dir containment exception and is derived data, not
Authority Attachment storage.

Core creates or admits the root through the existing native private-directory primitive: normalized native absolute path,
local fixed NTFS volume, stable opened identity, no reparse root, current-user owner, protected DACL limited to current user
and SYSTEM, and non-inheritable retained handles. The root marker and lock use private-at-birth file primitives. Directly
managed `.staging`, `camps`, operation, Camp, Entry and payload container directories use the same private-directory
admission; copied descendants inherit only the private user/SYSTEM ACL and final files are read-only hardened.

Existing unknown directories with inherited/broader ACL, reparse points, wrong owner or identity drift are rejected rather
than repaired and reused. Runtime receives only the current Camp's exact `attachments` child, never `<data_dir>`,
`runtime-files`, `camps`, Authority Attachment or another Camp.

## 2. Platform qualification

Private storage implementation is necessary but not sufficient for Runtime access. All current `windows-x64` Adapter rows
remain `not_qualified`; each requires its own directory-authorization, read-only behavior, process lifecycle and sandbox
evidence before execution can receive a Camp View root. Windows readonly/DACL hardening is not described as strong
same-SID isolation.

## References

- [Windows Private Storage v1](windows-private-storage-v1.md)
- [Camp Published Attachment View v1](camp-published-attachment-view-v1.md)
- [Windows Desktop Platform](../architecture/windows-desktop-platform.md)
