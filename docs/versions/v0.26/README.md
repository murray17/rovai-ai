---
document_type: version-overview
version: v0.26
lifecycle: current
authority: version-scope-and-status
design_status: frozen
implementation_status: complete
last_updated: 2026-07-31
---

# Rovai-ai v0.26 Member Runtime Parameters

> 状态：设计已冻结，生产实现与本地验收已完成
>
> 前置版本：[v0.25 Attachment Composer](../v0.25/README.md)
>
> 跨版本决策：[ADR-0082](../../adr/0082-member-owned-runtime-parameters.md)
>
> 生产设计：[production-design.md](production-design.md)
>
> 实施与验收：[implementation-plan.md](implementation-plan.md)

## 版本目标

在成员页现有“Agent运行时”区域下增加默认收起的“运行参数”，恢复成员级模型、模型
参数和 Runtime 原生权限控制，同时继续由 Core 管理 Installation、路径、fingerprint、
认证范围和探测证据。完整配置只影响以后创建的新 AgentRun。

## 已确认范围

- Product Runtime、模型策略和权限参数组成一个原子保存的成员配置。
- Runtime 未就绪时仍可只保存产品选择；后续就绪不自动补参数。
- `runtime_default` 同时跟随默认模型和默认模型参数，不保存覆盖值。
- 固定模型只展示该模型能力快照实际报告的参数。
- 九种 Runtime 使用专用组件、原生字段和值，不做跨 Runtime 转换。
- 首次显式保存采用每个 Adapter 明确定义的最宽松权限默认值。
- UI 不显示危险/高风险标签，不使用警告色，不增加二次确认。
- 能力变化导致配置失效时进入 `needs_attention`，不静默修复。
- v41 Migration 清空全部既有成员 Runtime 选择与参数，不提供兼容迁移。
- 普通成员页不展示 Installation ID、路径、fingerprint、auth scope 或探测/迁移信息。

## Runtime 字段

| Runtime | 模型参数 | 权限参数 |
|---|---|---|
| Codex CLI | `reasoning_effort` | `sandbox_mode`, `approval_policy` |
| OpenCode | snapshot 报告时使用 `reasoning_effort` | `permission` |
| GitHub Copilot CLI | snapshot 报告时使用 `reasoning_effort` | `allow_all` |
| Claude Code | `effort` | `permission_mode` |
| Kiro CLI | 无通用推理参数 | 无持久化权限字段 |
| Qoder CLI | snapshot 报告时使用 `reasoning_effort` | `permission_mode` |
| CodeBuddy | snapshot 报告时使用 `reasoning_effort` | `permission_mode` |
| Qwen Code | snapshot 报告时使用 `reasoning_effort` | `approval_mode` |
| Antigravity | 无通用推理参数 | `mode`, `sandbox`, `dangerously_skip_permissions` |

## 非目标

- 自定义 Installation、可执行路径或 auth scope 的成员级选择。
- 跨 Runtime 统一权限等级、字段转换或兼容别名。
- 修改既有冻结 AgentRun。
- Night 视觉设计；继续使用 Arctic Dawn Day。

## 完成定义

ADR、Migration、Core 原子命令、九种 Runtime 编辑器、Readiness/冻结边界、Renderer
语义测试、Core 测试、Typecheck、桌面构建和本地 macOS arm64 打包全部通过。
