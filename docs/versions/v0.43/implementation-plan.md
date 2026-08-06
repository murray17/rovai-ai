---
document_type: implementation-plan
version: v0.43
authority: implementation-plan-and-acceptance
status: closed_incomplete
last_updated: 2026-08-06
---

# v0.43 实施与验收计划

> 冻结结果：本计划已关闭但未完整验收。Checkpoint 7 中未勾选的真实 Runtime Smoke 在
> v0.43 冻结前没有完成；保留原始勾选状态，不把自动验证或打包成功等同于 Runtime 实证。
> v0.44 将删除公共历史摘要系统，而不是补做摘要 Job Smoke；其余未完成的 Runtime 证据若仍
> 有产品价值，应在后续版本中重新立项并定义验收边界。

## Checkpoint 1：版本、ADR 与领域语言

- [x] 冻结 v0.42 并把 current pointer 切换到 v0.43；
- [x] 接受 ADR-0125 additive external MCP 与 Adapter-specific same-name policy；
- [x] 接受 ADR-0126 Codex Native Home 与外部 Session ownership；
- [x] 更新 `CONTEXT.md` 的 Assignment、Additive Projection、Same-Name Policy、Exposure、
  Projection Diagnostic、Conversation 与 Native Session。

## Checkpoint 2：两阶段 Projection 与能力模型

- [x] `ExternalMcpProjection` 只保留 `AdditivePerRun | Unsupported`；
- [x] Core 生成 Requested Projection，Adapter 完成 native discovery/collision finalization；
- [x] Exposure 增加 projection mode、same-name policy、collision disposition 与
  `SkippedNativeNameConflict`；
- [x] 删除 exact/replacement、Copilot alias 和所有 `degrade_external()`/空集合重试；
- [x] Ready injection 被 Runtime 拒绝时 AgentRun 启动失败。

## Checkpoint 3：Codex Native Home

- [x] AgentRun 与 Camp 公共历史摘要 Job 均不创建或设置 Rovai `CODEX_HOME`；
- [x] 删除 `CodexHomeManager`、marker/lock/config generation、Camp cleanup/GC 与数据库记录；
- [x] 数据合同提升为 v0.43 / projection schema 21 / read-model schema 21，clean break 清理旧
  Rovai-owned Home 与旧领域列；
- [x] `config/read` 改为收集有效 native MCP 名称；
- [x] `thread/start` 与 `thread/resume` 通过 `config.mcp_servers` 追加不同名 Server；
- [x] 删除 `home_created_or_rebuilt` replacement 和 external MCP process digest。

## Checkpoint 4：七 Runtime additive 与 Antigravity honesty

- [x] OpenCode 恢复 user/project MCP，并通过 ACP Session 追加 Rovai Server；
- [x] Copilot 删除 builtin/native disable 与 private alias，只使用 additional config；
- [x] Claude 删除 strict config；
- [x] Kiro 启用 native `mcp.json` 并以 Agent config 覆盖同名；
- [x] Qoder、CodeBuddy、Qwen 删除 strict/allowlist exact-isolation 参数；
- [x] Antigravity 保持 external MCP Unsupported 且不写 Workspace 文件。

## Checkpoint 5：Renderer 与诊断

- [x] Skill、MCP、Agent 运行时、外观、通知与诊断统一使用无外框共享设置页头；
- [x] MCP 配置页不按 Runtime capability 过滤、禁用或警告 Assignment；
- [x] 诊断页显示 Antigravity Unsupported；Capability/Exposure 记录 projection mode 与
  same-name policy；
- [x] Exposure 诊断显示 skipped/collision disposition，不把原生同名 Server 冒充 Rovai Server。

## Checkpoint 6：自动验证

- [x] `cargo fmt --all -- --check`；
- [x] `cargo test --workspace`；
- [x] `cargo clippy --workspace --all-targets -- -D warnings`；
- [x] `pnpm typecheck`；
- [x] `pnpm test`；
- [x] `pnpm build:desktop`；
- [x] `git diff --check` 与被删除逻辑静态扫描。

## Checkpoint 7：真实 Runtime 与 Release

- [ ] Codex native Home/new/resume/additive/collision/摘要 Job Smoke；
- [ ] 七个 Additive Runtime 的 native-preservation 与 same-name 实际调用；
- [ ] Antigravity no-workspace-mutation 与 diagnostics-only 验收；
- [x] Release Core/CLI、arm64 App 打包和最终代码/文档一致性复核。

## Checkpoint 8：领域契约 clean break

- [x] AgentProfile 继续作为应用全局 Member 持久对象；CampMember 只保留 Camp 关系；
- [x] Contracts、IPC、Renderer、Core 命令和 Runtime Context 统一使用 `agentId`，不保留当前兼容别名；
- [x] `CampTaskView` / `CampTaskStatus` 重命名为 `TaskView` / `TaskStatus`，删除旧执行型 Task DTO；
- [x] 从当前 Camp DTO、查询、通知和 UI 删除 `status = archived`；migration 57 物理删除
  `camp.status` 与 `camp.archived_at`；
- [x] 删除 legacy Project DTO；Project 继续只由 Camp 读取模型派生；
- [x] 删除 legacy Timeline/textarea Mention 投影；结构化 Mention 统一显示 `@所有队员`；
- [x] 从当前 AgentProfile、CampMember 和 Camp 创建预检 DTO 删除 legacy handle，并删除普通
  `@文字` 的 handle/名称解析与 Renderer 重写；
- [x] Runtime Context 名册使用 `members`，产品中文术语统一为“队员”；
- [x] IPC 产品命名空间从 `agents.*` clean break 为 `members.*`，不保留别名；
- [x] 用户 CampMessage 只允许精确 Draft Revision 写入，删除 body/address 旧发送与
  `create_camp_from_first_message`；所有 CampMessage 强制 Structured Content；
- [x] AgentProfile 公开 Runtime 合同收敛为原子 `runtimeConfiguration` 与 Readiness，
  `ResolvedRuntimeBinding` 仅供 Core/Diagnostics；
- [x] AgentRun Context formatter 升为 v8，并由 Rust/TypeScript 共用冻结 fixture；
- [x] 通知 Inbox 与 CreatedBatch item schema 统一为 v2；
- [x] v0.36 密封资格评测只在版本化适配边界投影其冻结历史字段，不进入当前产品契约。
