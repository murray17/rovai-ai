---
document_type: adr
id: ADR-0220
title: Runtime Model Catalog Stale-While-Revalidate and Execution-Time Validation
status: accepted
date: 2026-08-18
decision_scope: cross-version
source_version: v1.11
supersedes: []
intended_supersedes: []
superseded_by: null
---

# ADR-0220: Runtime Model Catalog Stale-While-Revalidate and Execution-Time Validation

## Context

队员配置需要快速、稳定地展示 Runtime 模型目录，但切换 Runtime 本身必须保持零副作用，真实 Runtime
进程也不能为了绘制表单而提前启动。正常保存的显式模型也可能在 Provider 更新目录后暂时或永久缺失；把“没有可用
目录”误判成“模型已失效”会阻断用户修复，而把缓存当成执行事实又可能在 Provider 目录变化后静默使用
错误模型。

Runtime discovery 具有外部进程、认证状态和 Provider 依赖。它需要可复用的 last-known-good，同时必须有
明确的新鲜度、最大服务窗口、失效和执行期核对边界。这些语义跨越 Core、Adapter、Renderer 与 AgentRun，
并直接影响是否启动第三方 Runtime，因此不能由每个 Picker 或 Adapter 自行决定。

## Decision

Core 拥有统一的 Runtime model catalog stale-while-revalidate 模块。切换 Runtime 只读取现有 Installation
snapshot；打开模型 Picker 才通过一个 Core interface 请求目录。成功目录在 60 秒内为 fresh，60 秒后至
24 小时内仍可立即服务并触发单飞后台刷新，达到 24 小时后不再作为可选目录服务。

刷新失败不得用空目录、fallback catalog 或失败快照覆盖 last-known-good。确定的 executable、安装、认证或
Provider 配置变化可以立即使目录失效；account/provider identity 只有在 Adapter 能提供稳定、非敏感证据时
才允许自动比较，否则以用户显式检查或真实执行重新建立证据。用户显式检查强制重新验证，但在结果产生前
不清空 last-known-good。

目录缓存只拥有配置体验，不拥有 AgentRun 真相。`runtime_default` 不依赖目录，配置与执行均不发送显式
model。显式模型在真实 Runtime Session/Host 建立后必须对当前实际广告目录进行核对；不存在或无法核对时
进入 typed `needs_attention`/不可执行结果，不得静默回退到 Runtime default。所有 Product Runtime 使用同一
缓存、Picker、Availability Check 与执行期验证规则；TRAE 仅继续遵守已有 purpose-scoped 启动限制和串行
真实验收要求，不形成产品级缓存或刷新特例。

## Consequences

- Runtime selection 保持零副作用，Picker 对 fresh/LKG 目录即时响应；超过最大窗口时诚实等待 discovery。
- 既有已保存显式模型在没有当前目录时显示“尚未核对”，而不是被无证据地宣告失效。
- 人工修改或技术恢复导致的损坏数据不属于兼容、迁移或修复范围。
- Core 必须拥有目录年龄、单飞刷新、失败保留和 typed check 终态；Renderer 只呈现这些事实。
- Adapter 必须在真实 Session/Host seam 核对显式模型，并保持 `runtime_default` 不发送 model。
- 现有 snapshot/attempt 时间戳足以表达该策略，因此本决定不要求新持久字段或 Data Contract migration。
- 本机真实 TRAE 验收必须串行，以避免第三方密钥/状态文件竞争；该测试约束不进入产品语义。

## Rejected Alternatives

- **切换 Runtime 时立即 discovery。** 这会把表单选择变成有外部进程副作用的操作，并放大竞态和认证干扰。
- **Picker 永久信任 snapshot。** Provider 目录变化后会无限服务过时模型，且无法解释既有保存值的当前有效性。
- **刷新失败清空目录或写 fallback。** 瞬时失败会摧毁 last-known-good，并把观测失败伪装成目录事实。
- **保存时的缓存校验作为最终执行事实。** 缓存可能在启动前变化，不能证明真实 Session 当前接受该模型。
- **为 TRAE 保留独立缓存策略。** 本机并发验收冲突属于测试调度问题，不应形成长期产品分支。

## References

- [v1.11 版本范围](../versions/v1.11/README.md)
- [Runtime Launch and Verification v9](../contracts/runtime-launch-and-verification-v9.md)
- [Runtime Catalog Boundaries](../architecture/runtime-catalog-boundaries.md)
- [ADR-0127](0127-atomic-member-runtime-configuration.md)
- [ADR-0192](0192-purpose-scoped-runtime-launch-and-execution-deferred-verification.md)
- [ADR-0204](0204-on-demand-runtime-deep-verification.md)
- [ADR-0208](0208-user-authorized-trae-light-and-availability-verification.md)
