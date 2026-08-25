---
document_type: contract
contract: runtime-platform-admission-v1
status: accepted
source_version: v1.28
last_updated: 2026-08-24
---

# Runtime Platform Admission v1

本合同拥有 Product Runtime 在精确主机平台上的产品级准入字段、错误和消费规则。准入理由见
[ADR-0210](../versions/v1.05/decisions.md#adr-0210)；本机 discovery、Installation、Probe 与
Ready 仍由 [Runtime Launch and Verification v7](runtime-launch-and-verification-v7.md)拥有。

## 1. Closed types

```ts
export type HostPlatformKey =
  | 'macos-arm64'
  | 'macos-x64'
  | 'windows-x64'

export type RuntimePlatformAdmissionStatus =
  | 'qualified'
  | 'not_qualified'
  | 'unsupported'

export type RuntimePlatformAdmissionReasonCode =
  | 'runtime_platform.qualification_evidence_missing'
  | 'runtime_platform.adapter_not_implemented'
  | 'runtime_platform.upstream_unsupported'
  | 'runtime_platform.authentication_unqualified'
  | 'runtime_platform.session_unqualified'
  | 'runtime_platform.builtin_transport_unqualified'
  | 'runtime_platform.lifecycle_unqualified'
  | 'runtime_platform.filesystem_semantics_unqualified'

export interface RuntimePlatformAdmission {
  runtimeKind: AdapterKind
  platform: HostPlatformKey
  status: RuntimePlatformAdmissionStatus
  reasonCode: RuntimePlatformAdmissionReasonCode | null
  evidenceRevision: string | null
}
```

`evidenceRevision` 是不可变、digest-bound 的资格证据标识，不是自由文本、构建时间或“最近测试”标签。
`qualified` 要求 `reasonCode = null` 且 `evidenceRevision != null`；其他状态要求稳定 `reasonCode` 且
`evidenceRevision = null`。未知枚举值 fail closed。

`HostPlatformKey` 不拥有最低 OS 版本、WSL、文件系统或存储位置。Windows 10 22H2+/Windows 11、native x64 与
local NTFS 由 Host/Storage Admission 独立检查；通过它们仍不能替代某一 Adapter 的 Runtime Platform Admission。

## 2. Authority and projection

Rust `AgentRuntimeAdapter` Registry 为唯一真源，并必须为 Product Runtime Catalog 中每个
`AdapterKind × shipped HostPlatformKey` 返回一行。Core Snapshot 投影完整矩阵；TypeScript、Renderer、Migration
和测试不得维护第二份 allowlist 或从 `process.platform` 推断状态。

## 3. Admission effects

| Consumer | `qualified` | `not_qualified` | `unsupported` |
| --- | --- | --- | --- |
| automatic discovery / availability check | allowed | omitted | omitted |
| managed Installation create/relocate | allowed | denied | denied |
| Onboarding / Member selection | enabled | disabled: `Windows 尚未验证` | disabled: `此平台不支持` |
| diagnostics | platform row + machine facts | platform row only | platform row only |
| AgentRun preflight | continue | `runtime_platform_not_qualified` | `runtime_platform_unsupported` |
| migration/default materialization | allowed | forbidden | forbidden |

Machine states such as `not_installed`, `needs_login`, `probe_failed`, `light_ready` or `ready` are unreachable until
platform admission is `qualified` and cannot encode either denied state.

## 4. Existing configuration preservation

An existing Member Runtime Configuration that becomes unqualified remains readable. A version-checked update may preserve
its Runtime subobject exactly while changing unrelated profile fields. It may not change any Runtime/model/permission
field, re-materialize defaults, create an Installation, or execute. A caller attempting such a Runtime change receives
`runtime_platform_not_qualified` or `runtime_platform_unsupported`; the error points to the Runtime field rather than
rejecting unrelated profile edits.

## 5. Qualification evidence

An Adapter becomes `qualified` only after its own reproducible evidence covers discovery, executable identity,
authentication, first run, Session continuation, Built-in Tool v14, approval, cancellation, final boundary, process-tree
cleanup and planned shutdown. Infrastructure tests for ACP, stdio or one-shot shapes are necessary but do not qualify
other Adapter identities.

Grok Build 使用独立的 `macos-arm64-grok-build-v1` digest-bound evidence；它只可使
`grok-build × macos-arm64` 为 `qualified`。同一 Adapter 的 macOS x64、Windows x64，以及其他 Adapter 的
任意平台行，都不能继承该结论。

## References

- [ADR-0210](../versions/v1.05/decisions.md#adr-0210)
- [Runtime Catalog Boundaries](../architecture/runtime-catalog-boundaries.md)
- [Runtime compatibility register](../runtime-compatibility.md)
