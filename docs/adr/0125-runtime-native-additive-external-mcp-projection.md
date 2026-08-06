---
document_type: adr
id: ADR-0125
title: Runtime-Native Additive External MCP Projection
status: accepted
date: 2026-08-06
decision_scope: cross-version
source_version: v0.43
supersedes:
  - ADR-0104
superseded_by: null
---

# ADR-0125: Runtime-Native Additive External MCP Projection

> 本决策替代 [ADR-0104](0104-rovai-preferred-mcp-projection-and-external-degradation.md)
> 的全 Runtime Rovai 同名优先、exact ambient isolation 与清空外部 MCP 后重试语义；局部
> 替代 [ADR-0018](0018-file-backed-mcp-library-runtime-projection.md) 的 exact per-Run
> Projection、Project 配置排除和 Unsupported 发送准入条款。MCP Library、稳定 Server ID、
> Assignment、逐 AgentRun 冻结 Projection Input、Exposure Snapshot、凭据 redaction 和
> Runtime-native approval 边界继续有效。

## Context

Rovai 过去为了保证 Assigned MCP 精确覆盖 Runtime 原生配置，会禁用、隐藏或隔离用户与项目
MCP，并在 Runtime 拒绝注入时清空整组外部 MCP 后重试。这一模型把用户原生 Runtime 环境视为
污染源，也让同一 MCP Assignment 在 Adapter 内承担了配置意图、可用性保证和启动降级三种
不同责任。

v0.42 已把 Rovai built-in operations 完全迁移到 bundled CLI；外部 MCP 不再需要为内部 Team
Gateway 取得 exact namespace。产品现在选择保留 Runtime 原生 MCP，把 Rovai Assignment 解释为
尽力追加请求，并从最终 Exposure 诚实报告每个 Server 的实际结果。

## Decision

### 只有 Additive 与 Unsupported 两种能力

`ExternalMcpProjection` 只包含：

- `AdditivePerRun`：保留 Runtime 原生 MCP，并为本 AgentRun 尝试追加 ready 的 Rovai MCP；
- `Unsupported`：Adapter 没有不修改用户配置的可靠动态追加通道。

系统不保留 `ExactPerRun`、`ReplacementPerRun`、隐式 replacement fallback 或 dead capability
variant。一个 Adapter 若未来只能通过 replacement 支持外部 MCP，必须在后续版本重新形成明确
产品决策，不能复用本合同的 additive 名称。

### Projection 分为 Core Request 与 Adapter Finalization

Core 先从冻结的 MCP Projection Input 生成 Requested Projection，只判断 Definition、enablement、
Assignment、环境解析和 transport 支持，不猜测 Runtime 原生 MCP。

Adapter 再根据当前 Runtime 实际配置层和自己的 channel 完成 Finalization。最终 Exposure 至少
区分 `ready`、`disabled`、`unassigned`、`adapter_unsupported`、`missing_environment`、`invalid`
和 `skipped_native_name_conflict`，并记录 projection mode、Same-Name Policy、collision
disposition 及非敏感 reason。Runtime-visible name mapping 只有 Adapter 确实使用私有名称时存在。

### 同名策略是 Adapter 能力

同名比较使用 canonical MCP Server Name 的 ASCII case-folded 语义，禁止把两个同名对象做字段级
merge。

- Codex 使用 `NativeWinsSkip`：从目标 app-server 的有效配置层发现原生名称；同名 Rovai Server
  不注入，并以 `skipped_native_name_conflict` 记录；
- OpenCode、Copilot、Claude Code、Kiro、Qoder、CodeBuddy 和 Qwen Code 使用 `RovaiWins`，但
  只有真实 Runtime 验收证明其高优先级 channel 会整项覆盖同名定义时才能声明 ready；
- Antigravity 当前为 `Unsupported`，因为只有 Global/Workspace 配置文件而没有可靠的
  Session-scoped dynamic channel。

Assignment 因此是期望投影意图，不是跨 Runtime 的同名 authority 保证。产品必须从 Exposure
说明最终生效者，不能把碰巧同名的原生 Server 冒充 Rovai Server。

### 没有 Runtime-wide 降级或运输 fallback

Definition-local 的 disabled、unassigned、missing environment、invalid、unsupported 或 native
collision 只影响相应 Entry；基础 AgentRun 可以继续，并在 Exposure 中留下精确结果。

一旦 Adapter 把 Entry finalise 为 `ready` 并声明 `AdditivePerRun`，Runtime 若拒绝该注入，说明
Adapter capability 不成立，AgentRun 启动失败。系统不得清空全部 MCP 后重启、自动切换到
replacement、改用新 request input 或把失败 Entry 改写成成功。

### 配置与诊断分离

MCP 设置页始终允许用户为有效 AgentProfile 配置 Assignment，不按当前 Product Runtime 过滤、
禁用或警告。Runtime 是否支持动态追加以及某个 AgentRun 的最终 Exposure 只显示在诊断页；它
不改变 Member eligibility、Assignment 持久化或普通配置流程。

Adapter 不写入或临时覆盖用户的 Runtime Global/Project/Workspace MCP 配置。进程内参数、
Session config、高优先级环境内容和 Rovai-owned 私有临时文件是允许的动态通道；无法满足时
必须报告 `Unsupported`。

## Consequences

- AgentRun 可以同时使用用户原生 MCP 与不同名的 Rovai MCP，不再以 exact isolation 为产品承诺。
- 同名行为不再跨 Runtime 完全一致，但每个 Adapter 的策略和最终处置都有冻结证据。
- 已分配 Server 的局部不可用不阻断基础 Run；已声明 ready 后的运输拒绝则 fail closed。
- Antigravity 成员仍能正常保存 Assignment，但当前 Run 不动态注入，并仅在诊断页披露。
- Runtime Smoke 必须分别证明原生不同名保留、同名策略、逐项 Exposure 和 ready 注入拒绝路径。

## Rejected Alternatives

- 保留 exact/replacement 作为默认或 fallback：会继续删除原生能力，并产生未公开的 authority
  切换。
- 保留未使用的 `ReplacementPerRun` variant：可序列化 capability 不是无害扩展点，会形成没有
  实现和验收的假合同。
- 全 Runtime 强制 Rovai 同名优先：Codex 需要私有 alias 或重新建立配置隔离。
- 全 Runtime 强制 Native 同名优先：会放弃其他 Runtime 已证明的高优先级整项覆盖能力，并增加
  不可靠的跨 Runtime 原生配置发现。
- Runtime 拒绝后清空外部 MCP 重试：会把 Adapter capability 失败伪装成正常启动。
- 为 Antigravity 临时改写 `.agents/mcp_config.json`：可能污染工作区、覆盖并发用户修改、在崩溃后
  留下配置或凭据，并无法约束外部 Antigravity 进程。

## References

- [v0.43 Runtime-native additive MCP](../versions/v0.43/README.md)
- [ADR-0018: File-Backed MCP Library and Per-Run Runtime Projection](0018-file-backed-mcp-library-runtime-projection.md)
- [ADR-0103: Canonical MCP JSON and Stable Assignment Identity](0103-canonical-mcp-json-and-stable-assignment-identity.md)
- [ADR-0124: CLI-Only Transport for Rovai Built-in Operations](0124-cli-only-transport-for-rovai-built-in-operations.md)
