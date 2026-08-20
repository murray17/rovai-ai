---
document_type: architecture
architecture: windows-desktop-platform
authority: windows-desktop-platform-composition
status: accepted
last_updated: 2026-08-20
---

# Windows Desktop Platform

本文组合 Windows x64 Desktop 的平台模块、进程、IPC、存储、Renderer 与发布边界。它不重新拥有 Runtime
领域、Built-in operation、Skill Library 或 AgentRun terminal 语义；这些长期权威仍由对应 ADR、Contract 与
Architecture 持有。

## 1. Supported host envelope

v1.05 目标为 Windows 10 22H2+ 与 Windows 11 native x64、MSVC、per-user、non-admin、local NTFS、Electron
native frame 和 NSIS。Windows ARM64、x86、WSL Core、MSIX/Store、企业 MSI、系统服务、UNC/network/removable
workspace 与 non-NTFS 不在首版准入。

Host envelope 通过不等于 Runtime 可选。每个 Adapter 还必须通过
[Runtime Platform Admission v1](../contracts/runtime-platform-admission-v1.md)。

## 2. Platform seams

| Module / seam | macOS implementation | Windows implementation | Stable caller interface |
| --- | --- | --- | --- |
| Local IPC | Unix Socket | protected Named Pipe | `LocalIpcEndpoint` + async byte stream |
| Managed process | process group + bounded signals | atomic Job-list `CreateProcessW` | `ManagedProcessLaunchSpec → ManagedProcess` |
| Runtime search | inherited/login-shell PATH + known dirs | inherited PATH/PATHEXT + known dirs | immutable Runtime Search Environment |
| Executable identity | device/inode + fingerprint | opened volume/file ID + fingerprint | frozen executable identity |
| Private storage | create-new + 0700/0600 | creation-time protected DACL | private create/atomic write helpers |
| Attachment traversal | `openat`/no-follow | handle-relative reparse-safe traversal | bounded immutable snapshot |
| SkillProjection | managed native links | copy + journal + root gate | reconcile/verify/Snapshot |
| Window chrome | hidden titlebar + traffic lights | native frame | platform presentation only |

These are real two-adapter seams. Domain callers do not select OS implementations or import `windows-sys`; Windows API
use remains inside the corresponding adapter.

## 3. Managed processes and shutdown

[Managed Runtime Process v1](../contracts/managed-runtime-process-v1.md) is the only Runtime/Probe launch interface.
Windows creates the child with its Job and explicit inheritable handles in one `CreateProcessW` operation. Runtime Platform
Admission only permits native EXE or an Adapter-owned validated Node shim resolved to `node.exe + entry script`; there is
no generic shell launcher.

Electron→Core stdin/stdout RPC remains. Main force-kill acceptance must prove Core observes EOF or a parent handle,
executes bounded shutdown and closes every Runtime Job. Process exit and Job cleanup never invent a Provider terminal;
Planned Shutdown and accepted-input recovery keep that authority.

## 4. Local IPC

[Built-in Tool Transport v18](../contracts/builtin-tool-transport-v18.md) inherits v14's one discriminated endpoint. Windows Pipe
instances are private at creation, byte-mode, local-only and authenticated again by process/lease tokens. The listener
creates the next secured instance before dispatching the connected one; inability to replenish closes admission.

The macOS Unix Socket implementation uses the same IPC v2 wire under v17. Router, receipt and replay remain
transport-independent.

## 5. Storage and filesystem

[Windows Private Storage v2](../contracts/windows-private-storage-v2.md) places Core and Electron state under separate
`%LOCALAPPDATA%\Rovai AI` children. Private objects are created with a protected DACL before becoming visible. Opened
handle identity, verified ancestry and reparse policy—not lowercase strings—own security and deduplication.

The derived Camp Published Attachment View is the explicit `<data_dir>\runtime-files` private child; Windows never uses
the macOS Home-based instance directory. Root/managed containers use native private-directory admission, and Runtime may
receive only one current-Camp `attachments` descendant. Authority remains under Core `camp-attachments`. This storage
backend does not qualify any Adapter: every `windows-x64` row remains `not_qualified` until independent exact-root,
read-only, sandbox and lifecycle evidence exists.

All three shipped EXEs embed `longPathAware`; host policy and the tested envelope are diagnostic facts. The installer
does not change HKLM. Unsupported storage or paths fail with stable blockers before Runtime input.

Attachment import opens and verifies each component under the admitted root, rejects reparse escape and copies from the
same verified handles. Skill Projection uses the separate multi-stage copy contract and does not write ownership markers
inside Runtime-visible Skill content.

## 6. Desktop and packaging

Windows uses the native frame. Renderer removes every custom drag region on `win32`, while Snap Layout, Alt+Space,
double-click maximize/restore, native window buttons and multi-monitor DPI remain OS-owned. Preload's existing platform
projection is presentation-only and does not decide Core security.

Packaging stages `rovai-core.exe` and `rovai.exe` per target without sharing dirty sidecar output with macOS. Formal
release separately Authenticode-signs Electron EXE, both sidecars and installer with SHA-256/RFC 3161 timestamp; the
verifier checks PE x64, manifests, signer allowlist for that release, timestamp, resources and hashes. SmartScreen
reputation is reported separately from signature validity.

Upgrade first requests App closure and completes planned shutdown before replacing a locked sidecar. New and old Core
must not run concurrently. Schema-incompatible downgrade is blocked explicitly.

## 7. UI and acceptance

[Windows Interaction Delta](../ui/windows-interaction-delta.md) owns cross-platform presentation differences without
creating a second product surface. Automated checks cover contracts and DOM behavior; real Windows 10/11 acceptance owns
native frame, DPI, High Contrast/Forced Colors, NVDA, IME, Explorer, installer, SmartScreen and upgrade behavior.

CI uses a fixed Windows Server runner for compile/package evidence and never presents it as Windows 10/11 UX evidence.
Signed release qualification requires real Windows 10 22H2 and Windows 11 machines or equivalent managed images.

## References

- [v1.05 overview](../versions/v1.05/README.md)
- [Runtime 平台安全不变量](foundational-invariants.md#runtime-platform-security)
- [Runtime 平台安全不变量](foundational-invariants.md#runtime-platform-security)
- [Built-in 运输不变量](foundational-invariants.md#skills-builtin-transport)
- [Runtime 平台安全不变量](foundational-invariants.md#runtime-platform-security)
- [Skill Library 与投影不变量](foundational-invariants.md#skills-library-projection)
