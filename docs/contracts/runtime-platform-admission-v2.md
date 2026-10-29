---
document_type: contract
name: Runtime Platform Admission
version: v2
status: accepted
source_version: v1.39
last_updated: 2026-10-28
---

# Runtime Platform Admission v2

v2 replaces [v1](runtime-platform-admission-v1.md). v1 的平台键、Core 单一真源、既有配置保留和
digest-bound qualification evidence 规则不变；v2 提供 `preview`，以及维护者明确按普通产品开放的 `enabled` 状态。

## 1. Closed types

```ts
export type HostPlatformKey =
  | 'macos-arm64'
  | 'macos-x64'
  | 'windows-x64'
  | 'linux-x64'

export type RuntimePlatformAdmissionStatus =
  | 'enabled'
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

`enabled` 表示维护者明确开放普通使用，`reasonCode = null`、`evidenceRevision = null`；不是 Preview，
也不声称完整平台资格验证已经完成。`qualified` 必须有非空 immutable evidence revision，且 `reasonCode = null`。`preview` 必须保留阻止正式资格化的
closed reason code，且 `evidenceRevision = null`；它不能被统计或描述为 First-Class/qualified。
`not_qualified` 与 `unsupported` 的 reason/evidence 规则沿用 v1。

v1.59 的 Linux x64 Server OS 与 Runtime 资格独立。Server 在目标发行版启动不晋升 Adapter。
Linux 按维护者确认的适配范围开放原有 14 个 Runtime 的 `preview`，显式排除 Cursor；后续新增的
DeepSeek Harness 也没有继承该批范围。preview reason 为 `runtime_platform.qualification_evidence_missing`，
evidenceRevision 仍为 null，允许 discovery、安装和真实验收。未来新增 Adapter 不自动继承此范围。
只有目标 Runtime 自己的发行版、版本和能力证据闭合后才晋升 `qualified`，也不增加 Linux Desktop。
DeepSeek Harness 已按这一独立路径完成 Linux x64 目标主机验收，不改变其余 preview 行。

## 2. Authority and projection

Rust Adapter Registry 继续是完整 `AdapterKind × HostPlatformKey` 矩阵的唯一真源。TypeScript、Renderer、Migration、
Discovery、Diagnostics 与 Dispatch 只消费 Core 投影，不维护独立 allowlist。`preview` 是 Product Runtime Platform
Admission，不是 Renderer-only Settings Preview；后者仍没有 Adapter、Installation、成员选择或执行语义。

## 3. Admission effects

| Consumer | `enabled` | `qualified` | `preview` | `not_qualified` | `unsupported` |
| --- | --- | --- | --- | --- | --- |
| discovery / availability check | allowed | allowed | allowed | omitted | omitted |
| managed Installation create/relocate | allowed | allowed | allowed | denied | denied |
| Onboarding / Member selection | enabled | enabled | enabled; actual machine status only | disabled: platform unverified | disabled: platform unsupported |
| diagnostics | platform row + machine facts | platform row + machine facts | platform row + machine facts | platform row only | platform row only |
| AgentRun preflight | continue with ordinary blockers | continue | continue with all ordinary runtime/capability blockers | `runtime_platform_not_qualified` | `runtime_platform_unsupported` |
| migration/default materialization | allowed | allowed | allowed | forbidden | forbidden |

Machine facts remain independent. `enabled` and `preview` do not manufacture installation, authentication, model, capability, Session or Ready
evidence; all ordinary checks and fail-closed Runtime blockers still apply.

Runtime management presents admitted rows with the reported version and actual machine-state badge. It does not
add testing, trial or experimental labels. Onboarding, member configuration and check feedback also omit
Preview qualification notices. They retain actionable installation, authentication and execution failures.
Core admission and its evidence remain available in diagnostics; removing UI copy never promotes admission.

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

The v1 byte-preserving rule remains for denied rows. `enabled` and `preview` configurations are mutable and executable like admitted rows, but
their runtime/model/permission values still pass the same Adapter schema, Installation and Dispatch validation as qualified rows.
No fallback Runtime or synthetic default may be created after failure.

## 6. MiniMax Code qualification

2026-10-18，User seq43 确认将 MiniMax Code 的 macOS Intel 标记验收通过。
`minimax-code-cli × macos-x64` 因此为 `qualified / reasonCode=null`，绑定独立的
[维护者确认记录](../../qualification/runtime-platform/macos-x64-minimax-code-v1.json)及其 SHA-256 revision，
允许普通 discovery、检查、成员选择和执行。记录保留确认来源，不推断目标主机的 CLI 版本、OS build
或逐项测试结果；本次没有重跑 Intel 模型会话。普通机器与执行检查继续沿用现有语义。
同日 Windows x64 经独立目标机验证，`minimax-code-cli × windows-x64` 为
`qualified / reasonCode=null`，绑定[Windows 0.6.12 记录](../../qualification/runtime-platform/windows-x64-minimax-code-v1.json)
及其 SHA-256 revision。十四轴、Golden Flows、修复和已接受能力边界见
[目标机报告](../research/minimax-code-runtime/windows-qualification-2026-10-18.md)。
macOS arm64 保持 Preview；Linux x64 的独立资格见下一节。能力差异仍由
[MiniMax 接入记录](../research/minimax-code-runtime/README.md)和兼容性清单分别记录。

## References

- [V1.39-D06](../versions/v1.39/decisions.md#v1-39-d06)
- [V1.49-D02](../versions/v1.49/decisions.md#v1-49-d02)
- [Runtime Launch and Verification v31](runtime-launch-and-verification-v31.md)
- [Runtime Catalog Boundaries](../architecture/runtime-catalog-boundaries.md)
- [Runtime compatibility register](../runtime-compatibility.md)


## DeepSeek Harness 增量准入

`deepseek-harness` 的 macos-arm64、macos-x64、windows-x64 与 linux-x64 四行均为
`qualified / reasonCode=null`，分别绑定自己的 SHA-256 evidenceRevision：
[macOS arm64 v2 增量验收归档](../../qualification/runtime-platform/macos-arm64-deepseek-harness-v2.json)、
[macOS x64 维护者目标主机验收归档](../../qualification/runtime-platform/macos-x64-deepseek-harness-v1.json)、
[Windows x64 v1 验收归档](../../qualification/runtime-platform/windows-x64-deepseek-harness-v1.json)与
[Linux x64 目标主机验收归档](../../qualification/runtime-platform/linux-x64-deepseek-harness-v1.json)。macOS arm64、
Windows 与 Linux 记录各自的独立证据；macOS x64 按仓库既有维护者目标主机验收先例记录明确的实测确认与发布批准，
不伪称本次提交重跑私密模型会话。普通 Settings/成员选择仍须通过 Machine Installation、认证、版本、模型、Probe 与
Ready 检查。取舍见 [V1.59-D10](../versions/v1.59/decisions.md#v1-59-d10)。

## 7. MiniMax Code Linux x64 qualification

2026-10-18，按维护者完成准入的要求，在 GNU x86_64 / Ubuntu 24.04.5、官方 mcode 0.6.12 与
真实 Sub2API Provider 下闭合 14 个能力轴。`minimax-code-cli × linux-x64` 为
`qualified / reasonCode=null`，绑定[目标主机记录](../../qualification/runtime-platform/linux-x64-minimax-code-v1.json)
的 immutable SHA-256 revision。实际目标机与三发行版 Server OS/ABI smoke 分开，不能互相代替。

真实模型、官方 CLI + 受控 Provider、真实 Linux 浏览器和 Rust owners 在
[验收报告](../research/minimax-code-runtime/linux-qualification-2026-10-18.md)分别记录；partial Usage、
原生权限/plan、取消问卷和原生管理命令的边界保持。其他平台、其他 Runtime、普通动态检查和执行
fail-closed 门槛不因本项晋升改变；不建立 Renderer allowlist。

## 8. Command Code macOS Preview

2026-10-25，User seq61 明确要求 macOS 两个架构开放。`command-code-cli × macos-arm64` 与
`command-code-cli × macos-x64` 均为 `preview / reasonCode=runtime_platform.qualification_evidence_missing`，
`evidenceRevision=null`，沿既有准入允许 discovery、检查、成员配置与普通执行。同日按 User 要求完成
Windows 补验后，Windows x64 同样采用 Preview；Linux x64 的独立 Preview 开放见第 9 节，其他 Runtime 的资格不变。

使用现有公开产品目录与官方安装说明入口，不增加 Renderer 平台白名单、专属门禁或实验标签。
Command 原生接入及 1.88.0 稳定版下限保持；本次开放不宣称已完成完整 Core/App、Intel 或子代理资格。
理由见 [V1.72-D60](../versions/v1.72/decisions.md#v1-72-d60)，既有实测与此次验证见
[Command Code 实施记录](../versions/v1.72/command-code-native-simplification.md)。

## 9. Command Code Linux Preview

2026-10-25，维护者要求完成 Linux 实测并与 macOS 开放改动一同交付。
`command-code-cli × linux-x64` 沿既有 Preview 准入开放发现、检查、配置和执行；
reason 为 `runtime_platform.qualification_evidence_missing`，evidenceRevision 仍为 null。
官方稳定版下限为 1.88.0，普通认证、模型、权限、能力和 Ready 门槛继续生效。

目标机的真实 Core、Sub2API、Linux 浏览器和故障注入分别记录于
[Linux 验收](../research/command-code-runtime/linux-acceptance-2026-10-25.md)。验收范围不继承到其他发行版、
ARM64、Windows、子代理或未来版本；Preview 不冒充完整平台资格。
已接受的原生命令非零退出状态差异及公开范围理由见
[V1.72-D61](../versions/v1.72/decisions.md#v1-72-d61)。

## Hermes 初始准入

2026-10-28 按维护者明确要求，Hermes 在 macOS arm64、macOS x64、Windows x64、Linux x64 均普通开放，
取代此前仅 macOS Preview 的范围。四行均为 `enabled / reasonCode=null / evidenceRevision=null`，
允许普通 discovery、检查、安装配置、成员选择与执行，不采用 Preview，也不显示实验或资格缺失提示。
设置、引导、成员和 Skills 选择、安装引导及监控筛选均消费 Core Admission，不另建平台白名单。
这项开放不伪造完整平台资格证据；既有原生模型记录仍按其目标主机范围解释。
兼容策略仍为 >=0.22.4，不锁 commit；普通机器与原生协议检查继续执行。
[当前合同](hermes-managed-runtime-v1.md)与[验证记录](../research/hermes-runtime/README.md)区分原生共享
Gateway 的受控验收、此前实现的真实 LLM 证据和未完成矩阵；不由一次 Ready 探测推断完整平台资格。
初始准入理由见 [V1.72-D62](../versions/v1.72/decisions.md#v1-72-d62)，当前接入边界见
[V1.72-D67](../versions/v1.72/decisions.md#v1-72-d67)。
