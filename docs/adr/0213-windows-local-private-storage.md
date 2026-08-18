---
document_type: adr
id: ADR-0213
title: Windows Local Private Storage and Filesystem Admission
status: accepted
date: 2026-08-18
decision_scope: cross-version
source_version: v1.05
supersedes: []
intended_supersedes: []
superseded_by: null
---

# ADR-0213: Windows Local Private Storage and Filesystem Admission

## Context

Electron defaults `userData` to roaming `%APPDATA%`, while Rovai persists machine-bound executable paths, SQLite,
attachments, Runtime-private state, managed blobs and projection journals. Creating these objects with inherited ACLs
and tightening them afterward leaves an exposure window. Network, removable and non-NTFS volumes also cannot be assumed
to provide the file identity, ACL and rename semantics required by the first Windows release.

## Decision

The Windows application stores all Core and Electron state beneath `%LOCALAPPDATA%\Rovai AI`. Core, Electron User Data,
Electron Session Data, Logs and CrashDumps use separate subdirectories, and every Electron `app.setPath` call occurs
before `ready`. Explicit isolated acceptance roots reproduce the same layout. macOS paths do not migrate in v1.05.

Windows MVP admits Core data and AgentRun workspaces only on local NTFS volumes. UNC, network, removable and non-NTFS
locations fail with a stable admission reason before an AgentRun or sensitive projection begins. Per-directory
case-sensitivity means normalized lowercase path strings are never security identity; opened-handle volume/file IDs and
verified ancestry own identity decisions.

Private directories and files are born with a protected DACL through native creation APIs. The current user SID and
SYSTEM receive the minimum required access; handles are non-inheritable. Existing objects are accepted only after owner,
DACL, object type, volume and reparse state validation. Rovai does not silently repair an unknown object and continue.

Electron, `rovai-core.exe` and `rovai.exe` embed `longPathAware`; startup diagnostics report the host policy. The
installer does not modify machine policy. Paths beyond the verified product envelope fail with an actionable blocker
rather than a generic I/O error or a claim of unlimited 32K support.

## Consequences

- Local-first machine state no longer roams or mixes Chromium cache with Core authority.
- The first Windows release deliberately excludes useful but semantically weaker filesystems until separately admitted.
- Native private-object creation becomes a shared platform module rather than a post-create permission helper.
- Corporate redirection or cloud-backed locations may be rejected and need explicit product follow-up.

## Rejected Alternatives

- **Keep Electron's default roaming userData.** Machine paths, cache and large local artifacts are unsuitable for roam.
- **Create objects normally and apply DACLs afterward.** Sensitive bytes can exist under inherited access first.
- **Lowercase paths as identity.** NTFS can enable per-directory case sensitivity and strings do not prove object
  identity.
- **Silently support every Windows filesystem.** ACL, file-ID and rename guarantees vary and would weaken fail-closed
  behavior.
- **Enable long paths by changing HKLM during install.** Per-user installation must not mutate machine policy.

## References

- [v1.05 Windows x64 scope](../versions/v1.05/README.md)
- [Windows Private Storage v1](../contracts/windows-private-storage-v1.md)
- [Windows Desktop Platform](../architecture/windows-desktop-platform.md)
- [Microsoft: File Security and Access Rights](https://learn.microsoft.com/en-us/windows/win32/fileio/file-security-and-access-rights)
- [Microsoft: Maximum Path Length Limitation](https://learn.microsoft.com/en-us/windows/win32/fileio/maximum-file-path-limitation)
