---
document_type: version-overview
version: v0.44
lifecycle: current
authority: version-scope-and-status
design_status: accepted
implementation_status: complete
last_updated: 2026-08-07
---

# Rovai-ai v0.44 AgentRun 确定性原始公共上下文

> 状态：实施与验收已完成。Formatter v9、ContextManifest v7、Read Model schema 22、
> Data Contract v0.44 / projection schema 23 与 Migration v59 已成为当前实现事实。
>
> 前置版本：[v0.43 Runtime-Native Additive MCP](../v0.43/README.md)
>
> 长期决策：[ADR-0129](../../adr/0129-deterministic-bounded-raw-public-context-delivery.md)
>
> 字段合同：[Context Delivery Profile v1](../../contracts/context-delivery-profile-v1.md)

## 版本目标

移除 AgentRun 公共消息上下文的全部 Segment/Epoch Summary 和 Context Compaction 链路，改用
确定性的原始 CampMessage 窗口：

- `CURRENT_INPUT` 始终完整；
- 每个 Native Session 只维护 Accepted Public Context Boundary；
- 自动历史只选择边界增量中最近的固定数量原始消息；
- 超长历史正文只保留可由 `camp.read` offset 续读的精确前缀；
- 整条省略通过明确 count、sequence envelope 和按需检索提示呈现；
- Member Call 额外获得 Core 派生的最初公开用户消息；
- ContextManifest 冻结 Profile version、选择证据和完整渲染 Blob；
- 摘要模型设置、后台生成、存储、状态和 UI 全部删除。

原始 CampMessage 是新的公共消息上下文唯一内容来源。`camp.search`、`history.search` 与
`camp.read` 继续提供边界封顶的原文回读，不维护逐条已读或未读状态。

## 冻结的投递合同

### 当前输入优先

用户消息触发时，触发消息只进入 `CURRENT_INPUT`。Member Call 触发时，私有 Call 正文只进入
`CURRENT_INPUT`，A2A 私有消息不进入 `SHARED_CONVERSATION`。

公共历史不能通过截断当前输入来挤占空间。移除全部 recent message 后仍无法容纳完整当前输入
与必需结构时，Run 以 `context_payload_too_large` 在 Runtime 投递前失败；消息事实保留，
边界不推进，不进入 context waiting 状态。

### 一个 ACK 边界

候选公开消息满足：

```text
sequence > lastAcceptedPublicBoundarySequence
sequence <= ContextManifest current public boundary
```

当前用户触发消息排除。Runtime ACK 后，边界推进到 Manifest 当前边界，即使部分候选消息只由
遗漏提示表示。后续同一 Native Session 不自动补投这些消息；Agent 仅在任务确实依赖时使用
历史工具回读。新 Native Session 从 previous boundary `0` 重新形成最近窗口和遗漏提示。

ACK 边界不进入模型上下文，也不限制历史工具的读取下界。工具仍可读取 Manifest 上限内任意
可见原始消息，包括已经投递过的消息；边界后新消息等待下一 AgentRun。

### Profile v1

```yaml
profileVersion: 1
maxPublicMessages: 15
maxPublicHistoryChars: 24000
maxMessageBodyChars: 2000
```

Profile 是应用发布内置、版本不可变、无用户设置入口的合同。正文预算按 Unicode scalar 计算，
originating message 参与字符预算但不占 recent 条数。Profile 只控制消息正文；其他元数据仍受
固定条数与 Runtime 总输入上限约束。

## Member Call originating message

Core 沿可信 A2A lineage 追溯当前协作链最初的公开用户 CampMessage。嵌套 Member Call 继承同一
origin；Agent 不提交该字段，也不复用 `replyToMessageId`。Origin 不占 15 条上限，按普通历史
前缀截断，已在 recent window 时按 message ID 去重。

## 删除范围

### Core、数据与后台任务

- Segment Summary、Epoch Summary、Coverage Baseline；
- Summary 表、frontier、attempt、waiter、区间关联与派生读取；
- Summary 生成器、调度器、后台 Runtime Job、模型调用、重试和 Camp blocker；
- Summary watermark、积压计数和 `waiting(context_compaction/context_overloaded)`；
- ContextManifest 的 Summary ID、coverage range 与 coverage proof；
- Summary 失败、等待、覆盖和 retrieval hint 的 Read Side/Audit 文案。

### 配置与 Desktop

- `ContextSummaryModelConfig` 及其 get/update Core API；
- Renderer、Preload、Electron Main 和 Core Client 对应 IPC；
- Summary provider/model 持久化与“留空使用成员主模型”的解析；
- `MemberAdvancedSettings`、`SummaryModelSettings`、“高级设置”展开按钮；
- “对话压缩模型”、摘要生成中、压缩失败和覆盖范围文案及无使用者 CSS/state/test。

## 明确保留

- Member Runtime Configuration 与模型、推理强度、Runtime 原生权限、sandbox 等运行参数；
- `camp.search`、`history.search`、`camp.read` 及其 ContextManifest Fence；
- 原始 CampMessage FTS、直接回复树、`replyToMessageId`；
- 公共消息附件信息、稳定 Camp Attachment Path 与当前输入附件；
- Runtime Input Delivery ACK、unknown-delivery reconciliation 与 Native Session 恢复；
- ContextManifest exact rendered payload、digest 和终态历史证据。

## 不在本版本

- 不新增逐条已读、未读或待补投状态；
- 不改变历史工具名称、搜索排序、读取模式或 Cross-Camp 授权；
- 不把 A2A 私有正文加入公共消息、FTS 或 Shared Conversation；
- 不增加可编辑的“上下文”设置页或成员高级设置空壳；
- 不根据关键词、重要性、回复链、Mention 或附件关系扩展窗口；
- 不在 v1 中根据 Runtime 或成员覆盖 Profile 数值。

## 验收阈值

1. Profile v1、Unicode scalar 前缀、条数/字符预算、origin 去重和淘汰顺序由共享 fixture 冻结；
2. Current Input 完整，超 Runtime 总上限明确失败且不推进边界；
3. Runtime ACK 单调推进当前 Binding boundary，未 ACK、旧 generation 和恢复竞态均 fail closed；
4. omission 只在整条消息缺失时出现，正文截断只返回 offset 字段；
5. `camp.search` / `camp.read` 能读取 Fence 内已投递或省略消息，不能看到 Fence 后消息；
6. Member Call root/nested/tombstone/dedupe 情形均由 Core lineage 测试覆盖；
7. Summary 配置、表、Job、IPC、UI、状态与静态文字扫描为零；
8. Member Runtime 参数、附件、回复树和四个历史工具回归通过；
9. Rust、TypeScript、Renderer、Migration、打包 App 与相关真实 Runtime Smoke 通过后才能标记完成。

实施顺序与证据记录在[实施与验收计划](implementation-plan.md)。

## 完成证据

- `cargo fmt --all -- --check`、`cargo test --workspace`（284 个库测试及全部 CLI/Main 测试）、
  `cargo clippy --workspace --all-targets -- -D warnings`；
- `pnpm typecheck`、`pnpm test`（174 个 Vitest 测试与 78 个 Node 测试）、
  `pnpm build:desktop` 与 `git diff --check`；
- Core、成员配置、双 Codex AgentRun 与 OpenCode recovery smoke；双 AgentRun 使用独立
  host/thread/turn，恢复保持同一 ContextManifest；
- arm64 `Rovai-ai.app` 打包、ad-hoc 签名严格校验、内置 Core/CLI Mach-O UUID 对照；
- 打包 App 的成员生命周期与头像 UI 验收，确认摘要高级设置消失且 Member Runtime Parameters
  保持完整。
