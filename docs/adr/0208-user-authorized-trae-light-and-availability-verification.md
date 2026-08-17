---
document_type: adr
id: ADR-0208
title: User-Authorized TRAE Light and Availability Verification
status: accepted
date: 2026-08-18
decision_scope: cross-version
source_version: v1.03
supersedes: []
intended_supersedes: []
superseded_by: null
---

# ADR-0208: User-Authorized TRAE Light and Availability Verification

## Context

TRAE CLI 的 `--version` 可能进入凭据存储初始化，因此 ADR-0192 曾禁止除真实 AgentRun 外的所有
TRAE 进程。该特例使同一 Runtime 设置页出现两套含义：其他 Runtime 在启动期有界版本命令成功后显示
“可用”，TRAE 只显示“已安装”；用户显式点击“检查可用性”也只能重复静态扫描，无法改变状态。

当前安装的 TRAE `0.120.52` 已再次证明 `--version` 可在有界时间内稳定返回身份，用户主动检查也能在
不发送 Prompt、不调用模型或工具的前提下完成 ACP `initialize` 与 `session/new`。继续保留 UI 特例会把
真实可用的产品动作表现为无效按钮，而把 `installed_unverified` 误当成永久产品状态。

## Decision

1. TRAE 允许 `DiscoveryVersion`、`AvailabilityCheck` 与 `AgentExecution` 三种启动目的；
   `InstallationRefresh`、`HealthProbe` 与 `DispatchPreflight` 继续禁止启动 TRAE。
2. 启动与显式 rescan 对 TRAE 执行和其他 Runtime 相同的有界 `--version` 轻检。成功生成
   `light_ready`，失败生成诚实的 `light_failed`；路径存在本身仍不能成为可用证据。
3. 用户显式 `runtime.product.check(trae-cn-cli)` 授权一次 manager-owned ACP 可用性检查。该检查使用保守
   `permission_mode=default`，只完成版本、`initialize` 与 `session/new`，不得发送行为验证 Prompt、调用模型、
   工具或外部 MCP。
4. Session 必须提供 ACP v1、Session ID、动态模型目录和权限模式目录才提交 Ready snapshot。认证、协议、
   Session 或目录缺失继续使用既有 authentication/incompatible/transient 分类；90 秒 manager deadline、
   单飞、两路并发、generation/fingerprint fence 和进程树清理保持不变。
5. Ready 提交后的 discovery event 只更新内存观察与 Renderer，不得在同一检查中再次写入静态 snapshot
   覆盖 Ready。后续启动轻检仍按既有 fingerprint 与 permission schema digest 规则决定是否保留 Ready。
6. `light_ready` 的 TRAE 成员仍允许 Runtime-default model 与静态权限 descriptor，并可在首次真实 AgentRun
   的唯一 Host 内重新建立 Session 证据后继续任务；显式检查不是运行任务的强制前置条件。

本决定局部替代 ADR-0192 中 TRAE 只允许 `AgentExecution`、静态检查固定生成
`installed_unverified` 以及用户点击不构成启动授权的条款，并局部替代 ADR-0204 中 TRAE 保持
`installed_unverified`/availability 禁止启动的条款。其余 purpose-scoped launch、后台不自动深检、
execution-deferred AgentRun 与权限默认边界保持有效。

## Consequences

- TRAE 与其他 Runtime 一样，在成功启动轻检后显示“可用”，设置页使用同一个“检查可用性”动作。
- 启动或 rescan 会执行 TRAE `--version`，因此上游若再次在该命令中访问钥匙串，macOS 可能显示其原生交互；
  产品不通过未公开环境变量或钥匙串修改规避该行为。
- 用户检查只验证可用性所需的协议与 Session catalog，不重放昂贵、可能超出 90 秒的兼容性行为测试。
- `installed_unverified` 继续作为旧数据与禁止启动目的下的静态回退兼容状态，但不再是正常启动成功后的
  TRAE 主状态。

## Rejected Alternatives

- **只把 `installed_unverified` 文案改成“可用”。** 这不会建立与其他 Runtime 相同的有界启动证据，也不会
  修复点击检查无效。
- **用户检查继续执行完整 Prompt/Tool 行为矩阵。** 该矩阵会调用模型并可能超过 Runtime Check 总截止时间，
  不属于日常可用性检查。
- **开放所有 TRAE launch purpose。** 后台 health、安装刷新和 dispatch preflight 不需要新增进程，继续按
  最小授权保持静态或执行期路径。
- **把显式检查设为首次任务的强制前置。** `light_ready` 已允许尝试执行，真实 Host 仍能在同一进程完成验证。

## References

- [v1.03 version scope](../versions/v1.03/README.md)
- [Runtime Launch and Verification v5](../contracts/runtime-launch-and-verification-v5.md)
- [Runtime Catalog Boundaries](../architecture/runtime-catalog-boundaries.md)
- [ADR-0192](0192-purpose-scoped-runtime-launch-and-execution-deferred-verification.md)
- [ADR-0204](0204-on-demand-runtime-deep-verification.md)
