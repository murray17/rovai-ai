---
document_type: adr
id: ADR-0006
title: "Multi-Runtime Adapter Boundary"
status: superseded
date: 2026-07-22
decision_scope: cross-version
source_version: v0.03
supersedes: []
superseded_by: ADR-0016
---

# ADR-0006: Multi-Runtime Adapter Boundary

## Context

v0.02 的执行路径以 Codex App Server 和共享 Codex Host 为中心。v0.03 同时接入 Codex CLI、OpenCode CLI、GitHub Copilot CLI 和 Antigravity CLI；它们分别使用 App Server、ACP 或非交互 CLI Process，能够提供的模型目录、权限请求、Session 连续性和进程复用能力也不同。

如果 Rust Core 直接依赖这些协议，或者强迫所有 Runtime 遵守同一种 Host 拓扑，协议差异会泄漏到领域与调度层。反过来，如果把共享协议实现误当成产品 Adapter，又会掩盖不同 CLI 的能力与安全语义。

## Decision

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

## Consequences

- 领域、命令和调度代码只依赖稳定 Adapter 合约，不需要理解 App Server、ACP 或 CLI 文本细节。
- Runtime 可以显式报告能力缺失和成熟度差异；Core 与 UI 不需要伪造跨 Adapter 的最低共同能力。
- Host 复用由 Adapter 的实际兼容条件决定，可以是长期共享、多 Host Pool 或每 Run 一个 Process，而不改变领域模型。
- 增加 Runtime 需要新的内置 Adapter、能力映射和真实集成验证；在动态 ABI 被单独决策前不能运行时加载任意实现。
- 共享 Installation 减少重复探测与多个真源，但任何路径、认证作用域或能力变化都必须通过集中刷新影响引用它的成员。

## Rejected Alternatives

- 在 `AgentRuntimeAdapter` 之外再建立公共 `AgentAdapter`。
- 让 Rust Core 直接依赖 App Server、ACP 或 CLI 输出格式。
- 把 ACP Client 当作 OpenCode 与 Copilot 共用的产品 Adapter。
- 要求所有 Runtime 使用相同的长期 Host 或一 Conversation 一进程拓扑。
- 为每个 AgentProfile 复制并拥有独立 Installation、认证和能力目录。
- 在 v0.03 提供未经独立安全设计的动态插件 ABI。

## References

- [ADR-0003: Execution Runtime](0003-execution-runtime.md)
- [ADR-0015: Action and Safety v2](0015-action-safety-v2.md)
- [v0.03 多 Runtime 成员管理](../versions/v0.03/README.md)
- [v0.03 实施计划与验收清单](../versions/v0.03/implementation-plan.md)
