---
document_type: version-overview
version: v0.43
lifecycle: current
authority: version-scope-and-status
design_status: accepted
implementation_status: in_progress
last_updated: 2026-08-06
---

# Rovai-ai v0.43 Runtime-Native Additive MCP、Codex Native Home 与领域契约收敛

> 状态：设计已确认，实施中。v0.43 把外部 MCP 从 exact/replacement 模型切换为
> Runtime-native additive projection，让普通 Codex AgentRun 回到 Codex 原生 Home，并完成
> Member、Agent ID、Task、Camp 生命周期与派生 Project 的 clean break。
>
> 前置版本：[v0.42 Built-in Tool CLI-only Transport](../v0.42/README.md)
>
> 长期决策：[ADR-0125](../../adr/0125-runtime-native-additive-external-mcp-projection.md)、
> [ADR-0126](../../adr/0126-codex-native-home-and-external-session-ownership.md)

## 版本目标

本版本改变用户管理的外部 MCP、Codex Native Session 存储边界和当前领域语言；v0.42 的 bundled
`rovai` CLI、Core Router、lease、receipt 和十二项 built-in operation 合同保持不变。

- `ExternalMcpProjection` 收敛为 `AdditivePerRun | Unsupported`；
- Core 先生成 Requested Projection，Adapter 再结合 Runtime 原生配置完成 Finalization；
- 不同名原生与 Rovai MCP 并存；Codex 同名 `NativeWinsSkip`，其余经证明的 Adapter 同名
  `RovaiWins`；
- 删除 exact ambient isolation、replacement、清空集合重试和 Runtime-wide degradation；
- Codex 的 AgentRun 与 Camp 公共历史摘要 Job 都不再设置 Rovai-owned `CODEX_HOME`；Conversation
  只保存并 resume 原生 `thread.id`；
- OpenCode、Copilot、Claude、Kiro、Qoder、CodeBuddy、Qwen 改用各自 additive channel；
- Antigravity 不改写 `.agents/mcp_config.json`，动态外部 MCP 保持 `Unsupported`；
- MCP 配置页不按 Runtime capability 过滤 Assignment；Unsupported 与最终 Exposure 只在诊断页
  披露。

领域契约 clean break 同时要求：

- `Member / 队员` 是应用全局 AgentProfile 的产品身份；CampMember 只表达 Camp 关系；
- 当前公开路由只使用 `agentId`，Agent UUID 只留在 Core 内部；
- 稳定工作对象统一命名为 `Task`，不保留 `CampTask` 或旧执行型 Task；
- Camp 不提供归档、回收站或恢复，只能存在或被永久删除；
- Project 没有独立实体或生命周期，只是按 Camp 工作目录读取时派生的导航分组；
- All Members Mention 显示为 `@所有队员`，结构化内容使用 `MemberMention(agentId)`。

## 产品合同

MCP Assignment 是尽力追加请求，不保证第三方 Server 在线，也不保证同名时跨 Runtime 使用同一
定义。Disabled、Unassigned、Missing Environment、Invalid、Adapter Unsupported 和
Native-name collision 都是逐 Entry Exposure 结果，基础 Run 可以继续。

若 Adapter 已把 Entry finalise 为 Ready 并声明 Additive，而 Runtime 实际拒绝注入，则 AgentRun
启动失败；系统不删除 Ready Entry、不开空集合重试，也不切换 replacement。

Codex 原生 Home 中的 thread、配置、日志、plugins、memory 和其他状态属于 Codex。Camp 删除只
删除 Rovai 数据和 Native Binding，不承诺清理外部 Runtime 文件。Camp 公共历史摘要使用
ephemeral、tool-disabled Codex thread，但同样继承 Native Home，不再创建临时 `CODEX_HOME`。

## 不在本版本

- 不为 Antigravity 修改 Global 或 Workspace MCP 文件；
- 不增加 MCP Assignment 的 required 开关；
- 不建立跨 Runtime 统一 MCP Proxy、OAuth 或 approval policy；
- 不迁移旧数据合同；v0.43 clean break 清理 Rovai-owned App 数据（包括旧 `codex-homes`），但
  永不触碰 Codex 原生 Home；
- 不改变 built-in CLI transport、MCP Library 文件真源或 Server/Assignment identity。

## 验收阈值

1. Rust、TypeScript、Renderer 测试、clippy 与 Desktop build 全部通过；
2. Codex 原生 user/project MCP 保留，不同名 Rovai MCP 可用，同名 Rovai MCP 精确标记 skipped，
   新 thread 与 resume 都通过；
3. 七个 Additive Runtime 分别证明原生不同名保留、同名 Rovai whole-definition precedence、
   discovery/read 和实际 MCP tool call；
4. Antigravity 不修改 Workspace，配置页仍允许 Assignment，诊断页显示 Unsupported；
5. Runtime 拒绝 Ready injection 时 AgentRun fail closed，代码中不存在空集合重试、replacement、
   exact-isolation flag 或任何 Rovai 设置 `CODEX_HOME` 的 Runtime 路径；
6. Release Core/CLI、arm64 App 打包与相关真实 Runtime Smoke 通过后才能标记完成。

实施任务与证据记录在[实施与验收计划](implementation-plan.md)。
