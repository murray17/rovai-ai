---
document_type: version-decisions
version: v1.05
lifecycle: historical
last_updated: 2026-08-18
---

# v1.05 决策记录

本文件按来源版本聚合迁移前的数字 ADR，保存当时的背景、选择、后果与被拒绝方案。它是历史理由来源，不是当前系统规范真源；当前规范从 [文档导航](../../README.md) 进入。

## 历史 ADR 索引

| 历史 ID | 决策 | 迁移时状态 |
| --- | --- | --- |
| [ADR-0210](#adr-0210) | Platform-Qualified Product Runtime Admission | `accepted` |
| [ADR-0211](#adr-0211) | Atomic Windows Managed Process Launch | `accepted` |
| [ADR-0212](#adr-0212) | Cross-Platform Local IPC for Built-in Tool Transport v14 | `accepted` |
| [ADR-0213](#adr-0213) | Windows Local Private Storage and Filesystem Admission | `accepted` |
| [ADR-0214](#adr-0214) | Crash-Recoverable Windows Skill Projection | `accepted` |

<!-- legacy-adr:begin id=ADR-0210 source-file-sha256=190dc8e96b4a9a0f1a40a2f092bc9245a02bb161d88d8cc0e691da15e7045e50 -->
<a id="adr-0210"></a>

## ADR-0210: Platform-Qualified Product Runtime Admission

迁移时原路径：`docs/adr/0210-platform-qualified-product-runtime-admission.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0210
title: Platform-Qualified Product Runtime Admission
status: accepted
date: 2026-08-18
decision_scope: cross-version
source_version: v1.05
supersedes: []
intended_supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0210 -->
<a id="adr-0210-context"></a>
### Context

The Product Runtime Catalog is a closed set of globally integrated Adapter identities, while Product Runtime
Availability describes discovery and verification on one machine. Adding Windows without another authority would
either present every catalog entry as supported before it has Windows evidence, or overload machine availability with
a product-support conclusion. Testing one representative process shape also cannot qualify every Adapter's discovery,
authentication, session, approval, cancellation, Built-in Tool and shutdown behavior.

<a id="adr-0210-decision"></a>
### Decision

Rovai adds **Runtime Platform Admission** between Product Runtime Catalog and Product Runtime Availability. Admission is
the product-level decision for one exact `AdapterKind × HostPlatformKey`; the platform key includes OS family and CPU
architecture. The Rust Adapter Registry is its sole source of truth, and TypeScript consumes a Core projection rather
than maintaining another matrix.

Admission has exactly three states: `qualified`, `not_qualified`, and `unsupported`. Its reason is a closed stable code,
and every `qualified` entry names a digest-bound evidence revision. OS-version and storage-volume eligibility are host
admission facts checked separately; `windows-x64` never implies that an unsupported Windows release, network volume, or
WSL environment is eligible.

Only `qualified` entries may enter automatic discovery, availability checks, managed installation creation,
Onboarding selection, Member Runtime selection, migration defaults, dispatch or diagnostics that execute a Runtime.
`not_qualified` is presented as “Windows 尚未验证”; `unsupported` is presented as an upstream/product unsupported
conclusion. Neither is rendered as `not_installed`, `probe_failed`, or another machine-availability state.

An existing configuration that references an unqualified platform entry remains readable and may be preserved byte for
byte while unrelated Member fields are saved. It cannot be changed, re-saved as a newly selected Runtime, or executed;
dispatch fails with `runtime_platform_not_qualified`. This preservation rule must not turn one historical Runtime value
into a blanket blocker for unrelated profile edits.

Qualification is per Adapter. Shared ACP, stdio, or one-shot execution shape evidence only qualifies platform
infrastructure; each selectable Runtime independently proves the matrix required by the current contract. Settings-only
preview identities remain outside both Product Runtime Catalog and Runtime Platform Admission.

This decision locally refines ADR-0065, ADR-0066 and ADR-0189 without replacing their catalog, availability, preview,
frozen-Run or no-fallback boundaries.

<a id="adr-0210-consequences"></a>
### Consequences

- A Product Runtime can remain a valid macOS catalog member while honestly unavailable for selection on Windows.
- Core, Contracts, Renderer and migration code gain a fourth authority and must keep its meaning distinct from machine
  availability.
- Windows support expands Adapter by Adapter only after reproducible evidence; protocol similarity cannot create a
  support claim.
- Existing unqualified configurations remain inspectable without silently granting new execution authority.

<a id="adr-0210-rejected-alternatives"></a>
### Rejected Alternatives

- **Add `not_qualified_on_windows` to Product Runtime Availability.** It would mix product admission with machine facts.
- **Keep a TypeScript-only Windows allowlist.** Renderer presentation cannot own execution authority.
- **Qualify one Runtime per execution shape.** Adapter-specific authentication, continuation and cleanup remain unproven.
- **Use `win32` as the key.** It conflates native x64, ARM64 and WSL conclusions.
- **Block every edit to a profile containing historical unqualified configuration.** It prevents unrelated corrections
  without improving execution safety.

<a id="adr-0210-references"></a>
### References

- [v1.05 Windows x64 scope](README.md)
- [Runtime Platform Admission v1](../../contracts/runtime-platform-admission-v1.md)
- [Runtime Catalog Boundaries](../../architecture/runtime-catalog-boundaries.md)
- [ADR-0065: Verified Runtime Catalog](../v0.19/decisions.md#adr-0065)
- [ADR-0066: Managed Product Runtime Resolution](../v0.20/decisions.md#adr-0066)
- [ADR-0189: Settings-Only Runtime Preview](../v0.83/decisions.md#adr-0189)
<!-- legacy-adr-body:end id=ADR-0210 -->
<!-- legacy-adr:end id=ADR-0210 -->

<!-- legacy-adr:begin id=ADR-0211 source-file-sha256=c92c638f293c20e0b122eafddd00a390577eec9ff06c858332723dacf4aa35a4 -->
<a id="adr-0211"></a>

## ADR-0211: Atomic Windows Managed Process Launch

迁移时原路径：`docs/adr/0211-atomic-windows-managed-process-launch.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
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
```

<!-- legacy-adr-body:begin id=ADR-0211 -->
<a id="adr-0211-context"></a>
### Context

Assigning a running Windows child to a Job Object leaves a window in which its first instruction can create a descendant
outside Rovai's process tree. Killing that child after a failed assignment cannot recover a descendant that already
escaped. The same launch path must also prevent accidental inheritance of Core Job, token and file handles and avoid
Windows executable-name ambiguity.

<a id="adr-0211-decision"></a>
### Decision

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

<a id="adr-0211-consequences"></a>
### Consequences

- A managed process and descendants are kill-on-close members before user code executes.
- The launcher is a deep module: Windows attribute-list, quoting, handle and Job complexity remains behind one interface.
- Existing Tokio `Command` call sites must route through a native Windows backend where its interface cannot express the
  required attributes.
- Tests must exercise immediate grandchild creation, Core/App force-kill, nested CI Jobs and handle leakage.

<a id="adr-0211-rejected-alternatives"></a>
### Rejected Alternatives

- **Spawn and immediately call `AssignProcessToJobObject`.** It retains an unbounded descendant escape race.
- **Use `CREATE_SUSPENDED`, attach, then resume as the standard path.** Windows 10+ provides the direct Job-list creation
  attribute and avoids another launch protocol.
- **Use `taskkill`, WMI or process enumeration.** They are observation-based cleanup, not ownership.
- **Allow each Adapter to build its own command line and handle policy.** That duplicates the security interface and
  makes omissions likely.

<a id="adr-0211-references"></a>
### References

- [v1.05 Windows x64 scope](README.md)
- [Managed Runtime Process v1](../../contracts/managed-runtime-process-v1.md)
- [Windows Desktop Platform](../../architecture/windows-desktop-platform.md)
- [ADR-0123: Exclusive AgentRun Runtime Fleet](../v0.41/decisions.md#adr-0123)
- [Microsoft: UpdateProcThreadAttribute](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-updateprocthreadattribute)
<!-- legacy-adr-body:end id=ADR-0211 -->
<!-- legacy-adr:end id=ADR-0211 -->

<!-- legacy-adr:begin id=ADR-0212 source-file-sha256=270fc93ab5f010ec264ff0eaa524f49e78f923b28a1fa840c07e1145bb8d03be -->
<a id="adr-0212"></a>

## ADR-0212: Cross-Platform Local IPC for Built-in Tool Transport v14

迁移时原路径：`docs/adr/0212-cross-platform-local-ipc-transport-v14.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0212
title: Cross-Platform Local IPC for Built-in Tool Transport v14
status: accepted
date: 2026-08-18
decision_scope: cross-version
source_version: v1.05
supersedes: []
intended_supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0212 -->
<a id="adr-0212-context"></a>
### Context

Built-in Tool Transport v13 freezes Unix IPC, protocol version 1 and the `builtin_cli.transport.v13` capability. Reusing
that identity for a discriminated endpoint and Windows Named Pipe would make equal compatibility identifiers describe
different context bytes and connection behavior. Maintaining two optional endpoint fields would also force clients to
guess precedence.

<a id="adr-0212-decision"></a>
### Decision

Rovai adopts Built-in Tool Transport v14 as a clean break. v14 keeps the fifteen canonical operations, CLI commands,
Envelope, receipt/replay, lease, idempotency and Agent Output semantics of v13, while replacing `core_socket` with one
required discriminated `LocalIpcEndpoint` supporting Unix Socket or Windows Named Pipe.

The contract, CLI command and Runtime capability versions become 14; local IPC protocol becomes 2. A v13 Context fails
closed under a v14 CLI and Core. Core and the bundled CLI are shipped and drained together, so the first v14 release has
no v13/v14 dual stack.

Windows uses a byte-mode Named Pipe with the existing newline-delimited JSON framing. Pipe security is applied at first
creation through `SECURITY_ATTRIBUTES`, remote clients are rejected, the first instance reserves the random per-Core
name, and every later instance receives the same protected DACL. OS access control does not replace process/lease tokens.

macOS also moves to v14 and must repeat the complete current Runtime transport regression; Windows eligibility remains
per-Adapter through Runtime Platform Admission. This locally refines ADR-0124's former all-Runtime global release gate:
every Runtime qualified on a shipped platform must pass v14, while an unqualified Windows Adapter stays unselectable
rather than forcing a false global support claim.

<a id="adr-0212-consequences"></a>
### Consequences

- Endpoint evolution is explicit in capability, context, digest, health and compatibility identities.
- Platform transport varies behind one local-IPC seam; Router and domain operations remain transport-independent.
- The macOS Unix backend cannot be assumed unchanged merely because v14 primarily enables Windows.
- An App update must drain old Runtime processes before starting the v14-only Core/CLI bundle.

<a id="adr-0212-rejected-alternatives"></a>
### Rejected Alternatives

- **Keep v13 and only increment IPC protocol.** The frozen v13 context and capability would become ambiguous.
- **Keep `core_socket` plus an optional pipe field.** Two sources create precedence and downgrade ambiguity.
- **Run v13 and v14 indefinitely.** Bundled same-version delivery does not justify a permanent dual protocol.
- **Use localhost TCP on Windows.** It expands firewall, port allocation and listener exposure semantics.

<a id="adr-0212-references"></a>
### References

- [v1.05 Windows x64 scope](README.md)
- [Built-in Tool Transport v14](../../contracts/builtin-tool-transport-v14.md)
- [ADR-0124: CLI-Only Built-in Operations](../v0.42/decisions.md#adr-0124)
- [Built-in Tool Runtime](../../architecture/builtin-tool-runtime.md)
<!-- legacy-adr-body:end id=ADR-0212 -->
<!-- legacy-adr:end id=ADR-0212 -->

<!-- legacy-adr:begin id=ADR-0213 source-file-sha256=3e13fcfdf403b3de33787ae1b77875b4ebbc14d4713576ad36050678ffe6cfa6 -->
<a id="adr-0213"></a>

## ADR-0213: Windows Local Private Storage and Filesystem Admission

迁移时原路径：`docs/adr/0213-windows-local-private-storage.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
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
```

<!-- legacy-adr-body:begin id=ADR-0213 -->
<a id="adr-0213-context"></a>
### Context

Electron defaults `userData` to roaming `%APPDATA%`, while Rovai persists machine-bound executable paths, SQLite,
attachments, Runtime-private state, managed blobs and projection journals. Creating these objects with inherited ACLs
and tightening them afterward leaves an exposure window. Network, removable and non-NTFS volumes also cannot be assumed
to provide the file identity, ACL and rename semantics required by the first Windows release.

<a id="adr-0213-decision"></a>
### Decision

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

<a id="adr-0213-consequences"></a>
### Consequences

- Local-first machine state no longer roams or mixes Chromium cache with Core authority.
- The first Windows release deliberately excludes useful but semantically weaker filesystems until separately admitted.
- Native private-object creation becomes a shared platform module rather than a post-create permission helper.
- Corporate redirection or cloud-backed locations may be rejected and need explicit product follow-up.

<a id="adr-0213-rejected-alternatives"></a>
### Rejected Alternatives

- **Keep Electron's default roaming userData.** Machine paths, cache and large local artifacts are unsuitable for roam.
- **Create objects normally and apply DACLs afterward.** Sensitive bytes can exist under inherited access first.
- **Lowercase paths as identity.** NTFS can enable per-directory case sensitivity and strings do not prove object
  identity.
- **Silently support every Windows filesystem.** ACL, file-ID and rename guarantees vary and would weaken fail-closed
  behavior.
- **Enable long paths by changing HKLM during install.** Per-user installation must not mutate machine policy.

<a id="adr-0213-references"></a>
### References

- [v1.05 Windows x64 scope](README.md)
- [Windows Private Storage v1](../../contracts/windows-private-storage-v1.md)
- [Windows Desktop Platform](../../architecture/windows-desktop-platform.md)
- [Microsoft: File Security and Access Rights](https://learn.microsoft.com/en-us/windows/win32/fileio/file-security-and-access-rights)
- [Microsoft: Maximum Path Length Limitation](https://learn.microsoft.com/en-us/windows/win32/fileio/maximum-file-path-limitation)
<!-- legacy-adr-body:end id=ADR-0213 -->
<!-- legacy-adr:end id=ADR-0213 -->

<!-- legacy-adr:begin id=ADR-0214 source-file-sha256=e1a35ea6f78f5d1210d8f21245a85a760f61aac4d2bb9abdee705a164ade30fa -->
<a id="adr-0214"></a>

## ADR-0214: Crash-Recoverable Windows Skill Projection

迁移时原路径：`docs/adr/0214-crash-recoverable-windows-skill-projection.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0214
title: Crash-Recoverable Windows Skill Projection
status: accepted
date: 2026-08-18
decision_scope: cross-version
source_version: v1.05
supersedes: []
intended_supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0214 -->
<a id="adr-0214-context"></a>
### Context

The macOS SkillProjection uses managed links and can replace one entry without copying a mutable directory. Windows MVP
cannot require administrator rights or Developer Mode, so it needs a copy backend. Windows directory moves do not
atomically replace an existing destination; a two-state `staging | ready` journal cannot distinguish crashes before or
after moving the old or new directory. Updating a shared discovery directory while an active Runtime may reread it also
creates a partial-copy exposure that the start-time snapshot cannot describe.

<a id="adr-0214-decision"></a>
### Decision

Windows uses a copy projection with a private, operation-identified, multi-stage journal. Publishing advances through
`prepared`, `old_moved_to_backup`, `new_promoted`, `verified`, `metadata_committed`, `cleanup_pending`, and `completed`.
Staging, final and backup are siblings on the same admitted volume, and every rename target must not already exist.

Each transition is durable only after copied files and the private journal are flushed, the filesystem operation
succeeds, and the resulting paths are reopened and verified. Recovery never trusts journal state alone: it reconciles
journal operation identity, DB observation and the opened identities/digests of final, staging and backup. A crash
between a rename, DB commit and journal update is handled idempotently; an ambiguous or externally changed state blocks
projection admission and preserves evidence for repair.

An **Execution Root Projection Gate** serializes launch registration with projection replacement on Windows. A launch
holds the shared side while it confirms a ready projection and records the active Run; an update holds the exclusive
side, waits for active Runs in that exact root to settle, and blocks new launches until recovery/publish completes. Core
recovers unfinished journals before opening the root to AgentRun launch. Filesystem work does not run inside a long
SQLite transaction.

Project-owned or externally modified entries are never overwritten or silently deleted. This decision locally replaces
ADR-0161's “active Run never blocks a newer projection update” rule only for the Windows copy backend. macOS link
projection and the remaining Library, root-access, dirty-trigger and start-time evidence boundaries remain unchanged.

<a id="adr-0214-consequences"></a>
### Consequences

- Windows publication is recoverable without claiming nonexistent directory-replace atomicity.
- A Skill update can temporarily wait for an active Windows root; truthful safety is preferred over shared-path
  instability during the copy swap.
- Journal and DB recovery gain explicit operation identity, durability and crash-injection obligations.
- True per-Run Skill isolation remains unavailable because Runtimes still discover one fixed root path.

<a id="adr-0214-rejected-alternatives"></a>
### Rejected Alternatives

- **Rename staging over an existing final directory.** Windows does not provide the required directory replacement.
- **Use a two-state journal.** It cannot classify the old→backup and staging→final crash windows.
- **Use version directories plus a pointer.** Supported Runtimes do not all discover an indirect path.
- **Require symlink/Junction privileges.** The per-user product must work without administrator or Developer Mode.
- **Allow updates during active Windows Runs.** Copy publication can expose incomplete or changing contents on reread.

<a id="adr-0214-references"></a>
### References

- [v1.05 Windows x64 scope](README.md)
- [Windows Skill Projection v1](../../contracts/windows-skill-projection-v1.md)
- [Skill Projection Reconciliation](../../architecture/skill-projection-reconciliation.md)
- [ADR-0161: Event-Driven Root-Scoped Skill Projection](../v0.58/decisions.md#adr-0161)
- [Microsoft: Moving Directories](https://learn.microsoft.com/en-us/windows/win32/fileio/moving-directories)
<!-- legacy-adr-body:end id=ADR-0214 -->
<!-- legacy-adr:end id=ADR-0214 -->
