---
document_type: version-overview
version: v0.39
lifecycle: historical
authority: version-scope-and-status
design_status: frozen
implementation_status: completed
last_updated: 2026-08-05
---

# Rovai-ai v0.39 Codex Runtime 隔离

> 状态：Codex Isolated Home 阻断修复已完成实现、真实 Runtime Smoke 与 packaged App 验收
>
> 前置版本：[v0.38 唯一实时 Task 卡](../v0.38/README.md)
>
> Codex 冻结合同：[codex-home-isolation.md](codex-home-isolation.md)
>
> 实施门禁：[implementation-plan.md](implementation-plan.md)

## 版本意图

修复 Codex 全局 app-server 读取用户原生 MCP 并与 Rovai 同名配置深度合并的发布阻断问题，
同时让每个 Camp 成员拥有隔离且可跨 AgentRun 恢复 Native Session 的 Codex Home。

## Codex Runtime 隔离阻断修复

Codex 轨已完成 grilling 并接受
[ADR-0107](../../adr/0107-camp-member-isolated-codex-home-and-agentrun-app-server.md)：

- Isolated Codex Home 以 `Camp ID + AgentProfile ID` 为身份，保留配置、外部 MCP 与 Native
  Session，跨 CampTurn/AgentRun 复用；
- Home 首次复制用户非 MCP config，删除用户顶层 MCP、禁用项目 `.codex` 层，再写入 Rovai
  frozen external MCP；真实用户 config 不修改；
- `auth.json` 共享软链接，用户插件状态保持可访问，插件内置 MCP 明确不属于顶层 exact
  isolation 承诺；
- `rovai_team` credential 只在 Runtime request 中注入，不落入持久 `config.toml`；
- 本期每条 AgentRun 启动并独占一个 Codex app-server，Run 终态立即关闭；后续 Run 使用同一
  Home 的 `thread/resume`，不再存在全局 Codex host pool；
- Camp 存续期间不做 24 小时或 30 天清理；永久删除 Camp 后立即清理并持久重试，未知孤儿
  72 小时后 GC。

具体目录、配置所有权、进程 fencing、Migration、失败恢复和验收矩阵以
[冻结实施合同](codex-home-isolation.md)为准。Checkpoint 1–5 的完成状态和验证范围记录在
[实施与验收计划](implementation-plan.md)。

## 后续版本

Camp 历史检索工具收敛已移至当前 [v0.40](../v0.40/README.md)，不再与本版本共享范围、
实施状态或发布门禁。
