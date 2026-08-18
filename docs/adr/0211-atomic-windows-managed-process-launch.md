---
document_type: adr
id: ADR-0211
title: Atomic Windows Managed Process Launch
status: accepted
date: 2026-08-18
decision_scope: cross-version
source_version: v1.05
supersedes: []
intended_supersedes: []
superseded_by: null
---

# ADR-0211: Atomic Windows Managed Process Launch

## Context

Assigning a running Windows child to a Job Object leaves a window in which its first instruction can create a descendant
outside Rovai's process tree. Killing that child after a failed assignment cannot recover a descendant that already
escaped. The same launch path must also prevent accidental inheritance of Core Job, token and file handles and avoid
Windows executable-name ambiguity.

## Decision

Every Core-managed Windows process is created through one `WindowsNativeProcessLauncher` module. The module accepts one
frozen managed-launch specification and returns a process already owned by its Job; Adapter, Probe and Fleet callers do
not invoke `CreateProcessW` or perform Job attachment themselves.

The launcher creates a Job Object, enables `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, constructs `STARTUPINFOEXW`, supplies
that Job through `PROC_THREAD_ATTRIBUTE_JOB_LIST`, and calls `CreateProcessW` with
`EXTENDED_STARTUPINFO_PRESENT`. It also supplies `PROC_THREAD_ATTRIBUTE_HANDLE_LIST`; `bInheritHandles` is true only for
this explicit list, and every listed stdio handle is deliberately inheritable. Job, token, context, journal and other
Core handles are non-inheritable and absent from the list.

The application path is an absolute, verified native executable passed as `lpApplicationName`. Arguments are serialized
from an argv vector according to the admitted target parser; prompt content remains on stdin. The launcher never sets
`JOB_OBJECT_LIMIT_BREAKAWAY_OK`, `JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK`, or `CREATE_BREAKAWAY_FROM_JOB`.

Runtime Probe, Codex Host, ACP Host, Claude Code, Antigravity, Runtime Fleet creation and every future Runtime Adapter use
this module. A platform or nested-Job condition that prevents atomic association fails closed before Runtime input is
accepted. `CREATE_SUSPENDED` and spawn-then-attach are not ordinary fallback paths.

This decision refines ADR-0123's process ownership and ADR-0168/ADR-0177's shutdown/reap implementation on Windows. It
does not change Runtime terminal authority or make process exit proof of a Provider outcome.

## Consequences

- A managed process and descendants are kill-on-close members before user code executes.
- The launcher is a deep module: Windows attribute-list, quoting, handle and Job complexity remains behind one interface.
- Existing Tokio `Command` call sites must route through a native Windows backend where its interface cannot express the
  required attributes.
- Tests must exercise immediate grandchild creation, Core/App force-kill, nested CI Jobs and handle leakage.

## Rejected Alternatives

- **Spawn and immediately call `AssignProcessToJobObject`.** It retains an unbounded descendant escape race.
- **Use `CREATE_SUSPENDED`, attach, then resume as the standard path.** Windows 10+ provides the direct Job-list creation
  attribute and avoids another launch protocol.
- **Use `taskkill`, WMI or process enumeration.** They are observation-based cleanup, not ownership.
- **Allow each Adapter to build its own command line and handle policy.** That duplicates the security interface and
  makes omissions likely.

## References

- [v1.05 Windows x64 scope](../versions/v1.05/README.md)
- [Managed Runtime Process v1](../contracts/managed-runtime-process-v1.md)
- [Windows Desktop Platform](../architecture/windows-desktop-platform.md)
- [ADR-0123: Exclusive AgentRun Runtime Fleet](0123-exclusive-agentrun-runtime-fleet.md)
- [Microsoft: UpdateProcThreadAttribute](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-updateprocthreadattribute)
