---
document_type: version-overview
version: v0.58
lifecycle: current
authority: version-scope-and-status
design_status: accepted
implementation_status: in_progress
last_updated: 2026-08-11
---

# Rovai-ai v0.58：可恢复 Runtime 漂移与受控重绑定

> 当前状态：Core 实现、自动化测试与通用仓库门禁已完成，真实 Copilot CLI 漂移验收待完成。
>
> 前置版本：[v0.57 可恢复的项目侧栏移除](../v0.57/README.md)

## 版本目标

把 AgentRun dispatch 的 Runtime fingerprint mismatch 从无条件 terminal failure 收敛为一次有界的
installation refresh、logical identity revalidation 与 effective Runtime rebind。正常 CLI 原地升级可以
继续同一 Run；身份、信任、权限、模型或协议无法重新确认时仍 fail closed。

## 交付范围

- dispatch 在 snapshot changed/stale、path invalid、probe required 或 executable fingerprint drift 时
  同步刷新 managed/custom Installation，并绕过后台刷新延迟；
- Run 冻结 Adapter、Installation、auth scope、模型选择语义和权限配置，refresh 后只允许相同 logical
  identity 解析出的 trusted + ready + compatible Runtime；
- `agent_run` 分离 initial reported version/fingerprint 与可更新的 effective Runtime 列，并以
  `runtime_rebind_count` 将自动 rebind 限制为一次；
- rebind 原子更新 `effective_config_json`、全部冗余 Runtime 列与 config digest，并写入 drift/rebound
  审计事件；
- refresh/rebind 后再次执行 snapshot blocker 与 executable integrity 检查，二次漂移或身份/兼容性
  失败才 terminal fail。

## 冻结边界

- 不移除 SHA-256、轻量文件身份或执行边界校验；
- 不从 Member 当前 live Runtime 配置重建旧 Run，不改变显式模型、权限或 Installation identity；
- 不无限重试，不为 refresh 启动未通过 deep probe 的 Runtime；
- 不声称实现代码签名、包管理器 receipt 或 artifact signature 验证；
- 不改变公开消息、CampTurn、ContextManifest、Runtime Input Delivery 或 Native Session ACK 权威。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v0.57 冻结为 historical，v0.58 成为唯一 current，并新增本版本概览与实施计划 |
| ADR | 已更新 | ADR-0156 局部替代 ADR-0075 的 Run executable fingerprint 永久不可变条款 |
| Contracts | 确认无需更新 | 不改变外部 IPC、Envelope、receipt、Renderer wire shape 或 Agent-facing error contract |
| Architecture | 已更新 | Built-in Tool Runtime 新增 dispatch 前 mutable Installation refresh 与 bounded rebind 边界 |
| UI | 确认无需更新 | 本版本不改变 Renderer 结构、文案、交互或视觉合同 |
| Runtime Activity | 确认无需更新 | drift/rebound 是 Core domain audit，不改变 Runtime Activity mapping 或 Evidence classifier |
| Runtime compatibility | 确认无需更新 | 不改变支持的 Runtime、最低版本或已验证能力结论 |
| Documentation routing | 确认无需更新 | 既有 Runtime architecture 与 CURRENT 主题入口足以路由本决策 |
| Root README | 确认无需更新 | 项目定位和常青能力不变，根 README 不记录版本局部恢复机制 |

## References

- [v0.58 实施与验收计划](implementation-plan.md)
- [ADR-0156](../../adr/0156-logical-runtime-identity-and-bounded-installation-rebind.md)
- [Built-in Tool Runtime architecture](../../architecture/builtin-tool-runtime.md)
