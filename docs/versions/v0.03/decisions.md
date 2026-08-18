---
document_type: version-decisions
version: v0.03
lifecycle: historical
last_updated: 2026-08-18
---

# v0.03 决策记录

本文件按来源版本聚合迁移前的数字 ADR，保存当时的背景、选择、后果与被拒绝方案。它是历史理由来源，不是当前系统规范真源；当前规范从 [文档导航](../../README.md) 进入。

## 历史 ADR 索引

| 历史 ID | 决策 | 迁移时状态 |
| --- | --- | --- |
| [ADR-0006](#adr-0006) | Multi-Runtime Adapter Boundary | `superseded` |
| [ADR-0007](#adr-0007) | Portable Conversation Handoff | `accepted` |

<!-- legacy-adr:begin id=ADR-0006 source-file-sha256=e29a5109e1d98e20890c1143f17cdb756ff2d5a6e1c7b3f5e60386bf2198a0ba -->
<a id="adr-0006"></a>

## ADR-0006: Multi-Runtime Adapter Boundary

迁移时原路径：`docs/adr/0006-multi-runtime-adapter-boundary.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0006
title: "Multi-Runtime Adapter Boundary"
status: superseded
date: 2026-07-22
decision_scope: cross-version
source_version: v0.03
supersedes: []
superseded_by: ADR-0016
```

<!-- legacy-adr-body:begin id=ADR-0006 -->
<a id="adr-0006-context"></a>
### Context

v0.02 的执行路径以 Codex App Server 和共享 Codex Host 为中心。v0.03 同时接入 Codex CLI、OpenCode CLI、GitHub Copilot CLI 和 Antigravity CLI；它们分别使用 App Server、ACP 或非交互 CLI Process，能够提供的模型目录、权限请求、Session 连续性和进程复用能力也不同。

如果 Rust Core 直接依赖这些协议，或者强迫所有 Runtime 遵守同一种 Host 拓扑，协议差异会泄漏到领域与调度层。反过来，如果把共享协议实现误当成产品 Adapter，又会掩盖不同 CLI 的能力与安全语义。

<a id="adr-0006-decision"></a>
### Decision

Rust Core 面向 Coding Agent Runtime 的唯一统一接口命名为 `AgentRuntimeAdapter`，不建立第二个公共 `AgentAdapter` 抽象。

首批内置实现为：

```text
AgentRuntimeAdapter
├── CodexCliRuntimeAdapter   ──> CodexAppServerClient
├── OpenCodeCliRuntimeAdapter ─> AcpClient
├── CopilotCliRuntimeAdapter ─> AcpClient
└── AgyCliRuntimeAdapter     ──> AgyCliProcess
```

每个 Adapter 独立拥有以下责任：

- 探测安装、版本、认证可用性和真实能力；
- 声明模型、结构化选项、原生权限和 Session 能力；
- 校验并冻结启动配置；
- 把上游协议事件、请求和结果转换为 Core 的强类型边界；
- 根据自身能力决定 Host/Process、Session、Resume、中断与清理策略。

`AgentRuntimeHostManager` / `AgentRuntimeHost` 只负责进程、连接、兼容复用和生命周期，是 Adapter 层内部组件，不是领域实体，也不是所有 Adapter 必须遵守的固定进程拓扑。App Server Client、ACP Client 和 CLI Process Driver 都保留在具体 Adapter 内部；Rust Core 不直接依赖其协议类型或输出格式。

OpenCode 与 Copilot 可以复用类型化 ACP 传输和协议驱动，但必须保持独立 Adapter、独立能力声明与独立安全语义。共享协议代码不能合并产品边界。

`AdapterInstallation` 是应用级共享资源，由 Adapter 类型、稳定启动入口及配置/认证作用域共同标识。多个 `AgentProfile` 可以引用同一 Installation，同时分别保存自己的模型和权限偏好；Profile 不拥有可执行文件、认证状态、能力目录或 Installation 生命周期。

v0.03 只注册编译进产品的内置 Adapter，不提供动态插件 ABI。未来如果需要第三方动态 Adapter，必须通过新的 ADR 定义信任、兼容、安全和升级边界。

<a id="adr-0006-consequences"></a>
### Consequences

- 领域、命令和调度代码只依赖稳定 Adapter 合约，不需要理解 App Server、ACP 或 CLI 文本细节。
- Runtime 可以显式报告能力缺失和成熟度差异；Core 与 UI 不需要伪造跨 Adapter 的最低共同能力。
- Host 复用由 Adapter 的实际兼容条件决定，可以是长期共享、多 Host Pool 或每 Run 一个 Process，而不改变领域模型。
- 增加 Runtime 需要新的内置 Adapter、能力映射和真实集成验证；在动态 ABI 被单独决策前不能运行时加载任意实现。
- 共享 Installation 减少重复探测与多个真源，但任何路径、认证作用域或能力变化都必须通过集中刷新影响引用它的成员。

<a id="adr-0006-rejected-alternatives"></a>
### Rejected Alternatives

- 在 `AgentRuntimeAdapter` 之外再建立公共 `AgentAdapter`。
- 让 Rust Core 直接依赖 App Server、ACP 或 CLI 输出格式。
- 把 ACP Client 当作 OpenCode 与 Copilot 共用的产品 Adapter。
- 要求所有 Runtime 使用相同的长期 Host 或一 Conversation 一进程拓扑。
- 为每个 AgentProfile 复制并拥有独立 Installation、认证和能力目录。
- 在 v0.03 提供未经独立安全设计的动态插件 ABI。

<a id="adr-0006-references"></a>
### References

- [ADR-0003: Execution Runtime](../v0.02/decisions.md#adr-0003)
- [ADR-0015: Action and Safety v2](../v0.06/decisions.md#adr-0015)
- [v0.03 多 Runtime 成员管理](README.md)
- [v0.03 实施计划与验收清单](implementation-plan.md)
<!-- legacy-adr-body:end id=ADR-0006 -->
<!-- legacy-adr:end id=ADR-0006 -->

<!-- legacy-adr:begin id=ADR-0007 source-file-sha256=db9e275c813cdaa18c367773e25b31e4caa78df994d7d5cd7220be1e0c966626 -->
<a id="adr-0007"></a>

## ADR-0007: Portable Conversation Handoff

迁移时原路径：`docs/adr/0007-portable-conversation-handoff.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0007
title: "Portable Conversation Handoff"
status: accepted
date: 2026-07-22
decision_scope: cross-version
source_version: v0.03
supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0007 -->
<a id="adr-0007-context"></a>
### Context

Lumen 的 `Conversation` 表达成员在 Camp 内的长期私有连续性，而上游 Runtime 的 Native Session 只在特定 Adapter Installation 和兼容配置中有意义。成员默认 Runtime、Installation 或 Session 级配置发生变化时，Lumen 需要保留逻辑 Conversation，同时不能把一个 Runtime 的 Session ID、隐藏推理或私有工具状态错误交给另一个 Runtime。

直接覆盖绑定会在新 Session 创建失败时丢失旧连续性；批量立即迁移成员的全部 Conversation 又会产生无用户执行意图的外部 I/O 和大量半迁移状态。

<a id="adr-0007-decision"></a>
### Decision

`Conversation` 的逻辑身份不随有效 Runtime 改变。有效配置按以下顺序解析：

```text
AgentProfile 默认配置
→ Conversation 可选显式 Override
→ AgentRun 创建时冻结的实际配置
```

已经创建或正在执行的 `AgentRun` 始终使用冻结配置，不受后续 Profile 或 Conversation 编辑影响。

Conversation 的当前 Native Binding 必须同时包含：

```ts
type NativeBinding = {
  adapterInstallationId: string;
  nativeSessionId: string;
  bindingCompatibilityDigest: string;
};
```

只有同一 Installation 且兼容摘要允许 Resume 时，Adapter 才能继续当前 Native Session。Adapter、Installation 或不兼容的 Host/Session 级配置发生变化时，必须创建新的 Native Session；旧 Session ID 不得交给新 Adapter 尝试恢复。

跨 Adapter 交接只携带 Lumen 拥有的可移植上下文，包括 Conversation 消息、摘要、水位、当前职责和稳定引用。Lumen 不承诺迁移上游 Runtime 的隐藏推理、内部压缩状态、未公开工具状态或其他私有上下文。

交接采用准备后换绑：

```text
解析并校验新 Runtime 配置
→ 创建新 Native Session
→ 物化可移植上下文
→ 使用 Conversation version、旧 Installation、旧 Session ID 和旧兼容摘要执行 CAS
→ CAS 成功后允许新 AgentRun 调度
```

新 Session 创建、上下文物化或 CAS 任一步失败时保留旧 Binding，并且不能启动使用半迁移上下文的 Run。换绑成功后停止旧 Host 对该 Conversation 的事件路由；旧 Session 与 Host 的清理由原 Adapter 最佳努力完成，不阻塞权威换绑。

`bindingCompatibilityDigest` 由 Adapter 根据影响 Resume 语义的 Host/Session 级配置规范化生成。纯 Run 级选项不得无故触发 Session 迁移；CLI 版本是否参与摘要由 Adapter 的真实兼容能力决定，不能全局硬编码。

Profile 默认配置变更采用惰性交接：保存偏好时不创建 Session、不启动 Host，也不批量迁移 Conversation；只有下一次明确创建 Run 的 Preflight 发现绑定不兼容时才执行上述流程。

<a id="adr-0007-consequences"></a>
### Consequences

- 用户可以在保持同一 Lumen Conversation 的情况下更换 Runtime，但只能保证 Lumen 持有上下文的连续性。
- 每个 Native Session 都具有明确的 Installation 与兼容配置身份，避免跨账户、跨协议或跨权限配置错误 Resume。
- 交接失败不会破坏旧 Binding，也不会留下半绑定 Run；代价是创建新 Run 前可能需要额外 Session 准备与上下文物化。
- Adapter 必须稳定计算兼容摘要并明确哪些配置影响 Resume；Core 不能替所有 Runtime 硬编码同一规则。
- 保存成员配置保持快速且无外部副作用，但多个 Conversation 会在各自下一次运行时分别完成惰性交接。

<a id="adr-0007-rejected-alternatives"></a>
### Rejected Alternatives

- 把 Native Session ID 脱离 Adapter Installation 单独保存或跨 Adapter Resume。
- 宣称可以迁移 Runtime 的隐藏推理、私有压缩或未公开工具状态。
- 保存成员配置时立即批量迁移该成员的全部 Conversation。
- 在新 Session 准备完成前覆盖旧 Binding。
- 交接失败后保留半迁移 Binding 或启动使用不完整上下文的 Run。
- 把所有模型或 Run 级选项变化都视为 Session 不兼容。

<a id="adr-0007-references"></a>
### References

- [ADR-0012: Collaboration v3](../v0.06/decisions.md#adr-0012)
- [ADR-0016: Multi-Runtime Execution Boundary v2](../v0.06/decisions.md#adr-0016)
- [v0.03 多 Runtime 成员管理](README.md)
- [v0.03 实施计划与验收清单](implementation-plan.md)
<!-- legacy-adr-body:end id=ADR-0007 -->
<!-- legacy-adr:end id=ADR-0007 -->
