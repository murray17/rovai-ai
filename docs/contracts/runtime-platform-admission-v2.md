---
document_type: contract
name: Runtime Platform Admission
version: v2
status: accepted
source_version: v1.39
last_updated: 2026-09-05
---

# Runtime Platform Admission v2

v2 replaces [v1](runtime-platform-admission-v1.md). v1 的平台键、Core 单一真源、既有配置保留和
digest-bound qualification evidence 规则不变；v2 增加可执行但未完成正式资格验证的 `preview` 状态。

## 1. Closed types

```ts
export type HostPlatformKey =
  | 'macos-arm64'
  | 'macos-x64'
  | 'windows-x64'

export type RuntimePlatformAdmissionStatus =
  | 'qualified'
  | 'preview'
  | 'not_qualified'
  | 'unsupported'

export interface RuntimePlatformAdmission {
  runtimeKind: AdapterKind
  platform: HostPlatformKey
  status: RuntimePlatformAdmissionStatus
  reasonCode: RuntimePlatformAdmissionReasonCode | null
  evidenceRevision: string | null
}
```

`qualified` 必须有非空 immutable evidence revision，且 `reasonCode = null`。`preview` 必须保留阻止正式资格化的
closed reason code，且 `evidenceRevision = null`；它不能被统计或描述为 First-Class/qualified。
`not_qualified` 与 `unsupported` 的 reason/evidence 规则沿用 v1。

## 2. Authority and projection

Rust Adapter Registry 继续是完整 `AdapterKind × HostPlatformKey` 矩阵的唯一真源。TypeScript、Renderer、Migration、
Discovery、Diagnostics 与 Dispatch 只消费 Core 投影，不维护独立 allowlist。`preview` 是 Product Runtime Platform
Admission，不是 Renderer-only Settings Preview；后者仍没有 Adapter、Installation、成员选择或执行语义。

## 3. Admission effects

| Consumer | `qualified` | `preview` | `not_qualified` | `unsupported` |
| --- | --- | --- | --- | --- |
| discovery / availability check | allowed | allowed | omitted | omitted |
| managed Installation create/relocate | allowed | allowed | denied | denied |
| Onboarding / Member selection | enabled | enabled with experimental disclosure | disabled: platform unverified | disabled: platform unsupported |
| diagnostics | platform row + machine facts | platform row + machine facts | platform row only | platform row only |
| AgentRun preflight | continue | continue with all ordinary runtime/capability blockers | `runtime_platform_not_qualified` | `runtime_platform_unsupported` |
| migration/default materialization | allowed | allowed | forbidden | forbidden |

Machine facts remain independent. `preview` does not manufacture installation, authentication, model, capability, Session or Ready
evidence; all ordinary checks and fail-closed Runtime blockers still apply.

## 4. Current Pi qualification

`pi × macos-arm64`、`pi × macos-x64` 与 `pi × windows-x64` are `qualified / reasonCode=null`, and each row binds
its own immutable Pi evidence revision. They participate in ordinary discovery, explicit checks, member selection,
diagnostics and AgentRun without experimental disclosure. Machine installation, authentication, model, Session and Ready
facts remain independent and fail closed.

This promotion follows the maintainer's completed target-host validation and explicit release approval. It does not let one
platform inherit another platform's result, and it does not change Pi's accepted capability differences such as External MCP,
structured Web Search or Camp Fast. Future platforms or materially incompatible Pi versions still require their own immutable
artifact and admission decision.

## 5. Existing configuration preservation

The v1 byte-preserving rule remains for denied rows. `preview` configurations are mutable and executable like admitted rows, but
their runtime/model/permission values still pass the same Adapter schema, Installation and Dispatch validation as qualified rows.
No fallback Runtime or synthetic default may be created after failure.

## References

- [V1.39-D06](../versions/v1.39/decisions.md#v1-39-d06)
- [V1.49-D02](../versions/v1.49/decisions.md#v1-49-d02)
- [Runtime Launch and Verification v31](runtime-launch-and-verification-v31.md)
- [Runtime Catalog Boundaries](../architecture/runtime-catalog-boundaries.md)
- [Runtime compatibility register](../runtime-compatibility.md)
