---
document_type: version-decisions
version: v1.01
lifecycle: historical
last_updated: 2026-08-18
---

# v1.01 决策记录

本文件按来源版本聚合迁移前的数字 ADR，保存当时的背景、选择、后果与被拒绝方案。它是历史理由来源，不是当前系统规范真源；当前规范从 [文档导航](../../README.md) 进入。

## 历史 ADR 索引

| 历史 ID | 决策 | 迁移时状态 |
| --- | --- | --- |
| [ADR-0207](#adr-0207) | Explicit Maximum-Authority Member Runtime Defaults | `accepted` |

<!-- legacy-adr:begin id=ADR-0207 source-file-sha256=dc05a3d4ed5166b022e311c1f0fc46a3e82e3986519eda46a657007f64977407 -->
<a id="adr-0207"></a>

## ADR-0207: Explicit Maximum-Authority Member Runtime Defaults

迁移时原路径：`docs/adr/0207-explicit-maximum-authority-member-runtime-defaults.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0207
title: Explicit Maximum-Authority Member Runtime Defaults
status: accepted
date: 2026-08-17
decision_scope: cross-version
source_version: v1.01
supersedes: []
intended_supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0207 -->
<a id="adr-0207-context"></a>
### Context

Rovai 的队员 Runtime 编辑器已经对 Codex、OpenCode、Copilot、Claude Code、Qoder、CodeBuddy、
Qwen Code 与 Antigravity 使用各自最高权限的初始值，但 TRAE 的 execution-deferred 配置仍固定为
`permission_mode=default`，Kiro 则没有持久权限字段。结果是同一项“显式选择 Runtime 并保存队员”操作
在十种 Product Runtime 间具有不一致的初始执行权威。

本机 Kiro CLI 2.16.1 的 `kiro-cli acp --help` 明确提供 `-a, --trust-all-tools`，其语义是自动批准全部
tool permission request。TRAE 0.120.52 的真实 Session 则已经广告
`default/bypass_permissions/plan`，其中 `bypass_permissions` 是“Accept All Tools”。这两项都具有可冻结的
Runtime-native 值，不需要从 enum 顺序、文案或交互提示推断。

最高权限默认会扩大新配置队员的副作用能力，但配置仍由用户显式选择并原子保存；后台 discovery、
迁移和 capability refresh 不得替既有队员扩大权限。

<a id="adr-0207-decision"></a>
### Decision

1. 对具有已验证原生最高权限值的 Product Runtime，Core 生成的 `memberRuntimeDefaults.permissions`
   使用该最高权限值。Renderer 只呈现 Core descriptor 和 draft，不自行推断或重写默认值。
2. TRAE 的新队员默认值改为 `permission_mode=bypass_permissions`。`installed_unverified` 静态 descriptor
   同时接受 `default` 与 `bypass_permissions`，但它仍不声称认证、ACP Session、模型或动态 capability
   Ready。首次真实任务继续只启动一个 TRAE Host，并在同一进程完成验证和执行。
3. Kiro 新增 Host-scoped `trust_all_tools=off|on` 队员权限字段，默认 `on`。真实 Agent Host 在值为
   `on` 时传入 `kiro-cli acp --trust-all-tools`；Probe、discovery 和 health check 不传该参数。
4. `CoreEnforcedV1 + read_only Workspace` 继续收窄 Runtime 权限：Kiro 不传 `--trust-all-tools`。成员保存值
   不被改写；收窄只属于该次执行的 effective launch policy。
5. Runtime descriptor 的 `recommendedValue` 继续表达上游或产品的保守建议，不是队员初始 draft 的权威。
   TRAE 推荐值保持 `default`，Kiro 推荐值保持 `off`。
6. 已保存的队员权限不得由迁移或后台任务扩张。Adapter 静态 permission schema digest 改变时，即使
   executable fingerprint 未变，也不得保留旧 Ready snapshot；discovery 降级为新的静态 snapshot，旧配置
   通过既有 drift blocker 要求用户显式重存。

本决定局部替代 ADR-0192 中“TRAE 未验证成员只允许安全默认权限”的条款；不改变 ADR-0127 的原子保存、
内部 resolved binding 或后台不得创建成员配置，也不改变 ADR-0204 的按需深检和 launch purpose 边界。

<a id="adr-0207-consequences"></a>
### Consequences

- 十种 Product Runtime 现在全部具有显式、可验证的最高权限默认；Kiro 由新字段补齐，TRAE 由安全默认改为最高权限。
- 新 TRAE/Kiro 队员在未手工调整时可执行更广泛副作用，用户仍可在保存前选择保守值。
- Kiro 的权限改变进入 Host compatibility digest，因此不同值不会复用同一 ACP Host。
- 旧 Kiro 配置不会被静默扩权；descriptor 漂移会要求用户重新确认。
- 静态 descriptor 仍只是配置/admission 事实，不升级为认证或动态 capability 证据。

<a id="adr-0207-rejected-alternatives"></a>
### Rejected Alternatives

- **继续让 TRAE 使用安全默认。** 这保留同一队员配置动作的跨 Runtime 不一致。
- **把 Kiro 的 `allowedTools` 猜成全局 `*`。** 官方配置不支持全局 wildcard；ACP 已有精确
  `--trust-all-tools` 参数，无需拼接工具名。
- **只在启动命令里硬编码最高权限。** 这会让 UI、持久配置、Host compatibility 与真实执行不一致。
- **迁移既有 Kiro 队员到 `on`。** 这会在没有用户显式保存的情况下扩大已有权限。
- **Probe 也使用最高权限。** 检查可用性不需要副作用授权，且会扩大 Probe 的安全边界。

<a id="adr-0207-references"></a>
### References

- [Runtime Launch and Verification v4](../../contracts/runtime-launch-and-verification-v4.md)
- [Runtime Catalog Boundaries](../../architecture/runtime-catalog-boundaries.md)
- [ADR-0127](../v0.43/decisions.md#adr-0127)
- [ADR-0192](../v0.87/decisions.md#adr-0192)
- [ADR-0204](../v0.98/decisions.md#adr-0204)
- [v1.01 version scope](README.md)
<!-- legacy-adr-body:end id=ADR-0207 -->
<!-- legacy-adr:end id=ADR-0207 -->
