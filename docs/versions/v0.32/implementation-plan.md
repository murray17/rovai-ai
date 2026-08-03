---
document_type: implementation-plan
version: v0.32
authority: implementation-status
status: complete
last_updated: 2026-08-03
---

# v0.32 实施与验收计划

## Checkpoint 1：文档与长期决策

- [x] 冻结 ADR-0091、v0.32 范围、术语和实施设计。
- [x] 将 v0.31 冻结为历史快照并更新唯一 current version 指针。
- [x] 更新相关有效 ADR 的局部替代说明、Runtime 兼容性和 UI 文案。

## Checkpoint 2：持久化与原子不变量

- [x] v44 Migration 创建 ConversationInput、ReturnObligation、Input sequence、Run trigger 和
  CampTurn slot accounting；v45 将升级数据中的 `inbox.send` 能力与 override 一次性规范化为
  `member.call`，不保留运行时 alias。
- [x] 数据库唯一索引保证每 Input 最多一个 Run、每 Run 最多一个 Input；Immediate 事务和 busy
  predicate 保证同一 Conversation 不会同时物化多个 A2A Input，既有 direct Run 排队合同不变。
- [x] Run 终态、Obligation 关闭和 Outcome 创建在一个事务中，无可观察中间态。
- [x] CampTurn Stop 同事务取消 pending inputs/open obligations。

## Checkpoint 3：Member Call 与 Runtime 对等

- [x] `team.call_member` 严格三必填一可选 Schema 与安全 accepted 回执。
- [x] 从活动 Tool 合同删除旧 tool identity、`source`、reply ID、generic references 和兼容 alias。
- [x] Codex、Claude、ACP、Antigravity、Attested Bridge 和权限 bundle 全部使用新 identity。
- [x] Return Policy、Task 接受时校验、深度和 Run Slot reservation 通过负例。

## Checkpoint 4：调度、恢复与上下文

- [x] 单 Conversation FIFO 物化，不合批、不跳队、不为多个 A2A Input 同时创建 queued Run；
  用户直接触发的 Run 仍可排队并由既有 Scheduler 串行执行。
- [x] Notify + 启动/周期 SQLite reconciliation 在 crash 前后保持 exactly once。
- [x] explicit return、Run Outcome、pre-Run failure Outcome 和无 Obligation 分支全部通过。
- [x] Member Call/Outcome Current Input 不暴露内部 ID、raw failure 或 final output。
- [x] `list_tasks` 与 Charter 禁止 sleep/轮询等待并说明自动恢复。

## Checkpoint 5：Turn 收敛与用户投影

- [x] pending Input/open Obligation 保持 CampTurn 非终态。
- [x] failed/cancelled/completed 聚合顺序与技术失败不被 Outcome 抹除。
- [x] InboxMessage 继续按真实 Agent 定向消息投影；Outcome 只进入 Activity/Audit。
- [x] Read Model 暴露 Input/Outcome 的安全状态和真实 Run 链接。

## Checkpoint 6：验证

- [x] `cargo fmt --all -- --check`
- [x] `cargo test --workspace`
- [x] `cargo clippy --workspace --all-targets -- -D warnings`
- [x] `pnpm typecheck`
- [x] `pnpm test`
- [x] `pnpm build:desktop`
- [x] Team/Context/Task/Memory Smoke 与 Qualification harness 活动契约全部使用 `call_member`。
- [x] 静态扫描确认生产 Tool 注册、Runtime 投影和脚本没有旧 identity 或可接受旧参数；负例测试、
  breaking-change 文档与历史证据保留旧字面量用于明确拒绝和溯源。

## Checkpoint 7：Qualification 与诊断 Benchmark

- [x] CAL-001 1.2.0 在四成员真实 Runtime 上完成 9 条 Member Call，但以 11 AgentRun 触发
  10 Run 上限，校准有效失败；按门禁没有启动十二次正式 Trial，正式 Pass Rate 不存在。
- [x] 在明确 `qualificationEligible=false` 的 post-gate 诊断模式下执行同一密封 TQ 矩阵，
  补齐 12 个有效结果并保留两次不计分异常尝试。
- [x] 诊断结果为 6/12；所有样本正常收敛且无预算触发，但全部是单一 Lead Run、0 Member Call，
  因而只形成 Lead 交付基线，不形成 Team Collaboration 结论。
- [x] Runner 0.32.3 在 Core shutdown 前冻结最终工作区，修复受管 Skill 清理被误判为越界的
  证据归因问题。
- [x] 脱敏 3×4 结果和 Review 通过 `execution=null` 的公共 Core RPC 投影到本地
  `benchmark` Project，没有创建伪 AgentRun。

## Checkpoint 8：Team Benchmark 修正

- [x] 会话与 Core 证据确认真实协作失败并非 MCP 发现或工具名错误：Agent 已发现并调用
  `team.call_member`，但冻结 AgentRun 仍持有旧 `inbox.send`，Core 正确返回
  `team_tool.capability_denied`；v45 已修复未来 Run 的持久能力来源。
- [x] 保留原密封 TQ 1.0 与 12 次结果作为 Lead-only 基线，另建私有 Team Pack revision 2；
  TQ001–TQ004 2.0 按任务自然分配评审、测试、前端和集成责任。
- [x] Runner 0.32.6 新增并强化密封 `collaboration` 合同与硬审计：要求指定成员真实运行、最少 Member
  Call、显式 Return、零 Core Outcome、Task completed、无开放交接、无重复路由，并拒绝 sleep
  或同一 Run 重复 Task List。
- [x] CAL-001 1.5.0 收敛为四 Runtime 运输校准；OpenCode 精确原生工具名和指定成员显式返回
  进入硬合同，复杂语义质量继续由 TQ Verifier 判断。
- [x] 使用修复后的 packaged Release Core 完成 Suite
  `v032-team-collaboration-20260802-formal4`：校准通过，12 个正式 Trial 全部有效；严格结果
  4/12、功能 6/12、边界 10/12、协作 12/12，未覆盖或合并 Lead-only 诊断成绩。

## Checkpoint 9：执行过程恢复修正

- [x] 复核真实 OpenCode 会话，确认 ACP `agent_message_chunk`/`agent_thought_chunk` 全部缺少
  item identity，旧 Renderer 因退回到单事件 ID 而把每个 token 渲染成独立段。
- [x] 当时先修正匿名 reasoning/narration 的相邻 delta 合并和 Tool/Plan/文件动作边界；
  reasoning 的可见投影随后由 Checkpoint 10 删除，narration 分段修正继续保留。
- [x] Camp Snapshot schema 14 为每个 AgentRun 暴露权威 Evidence 总数；终态 Run 不再因全 Camp
  最近 1200 条窗口未覆盖自身记录而失去“处理过程”入口。
- [x] 新增 `agentRunEvidence.list`，在 Camp 归属验证后按 Run sequence 提供最大 1000 条的稳定
  分页；Renderer 只在展开缺失历史时读取全部页，并继续保留大 Evidence 的受控完整内容入口。
- [x] Core 分页、匿名 ACP 分段、Tool 边界、历史过程入口和多页读取均有回归测试。

## Checkpoint 10：Renderer 隐藏 reasoning

- [x] Codex reasoning summary、ACP thought 和通用 reasoning activity 不再生成用户可见过程正文，
  运行中状态也不再显示“正在整理思路”。
- [x] reasoning/thought 仍作为不可见语义边界防止相邻公开 narration 错误合并；Core 的
  ADR-0061 Evidence 持久化与 Runtime 协议保持不变。
- [x] 历史分页中的 reasoning 及其截断完整内容入口一并隐藏；公开 narration、Plan、Tool、
  文件动作和错误证据继续展示。
- [x] Renderer 回归测试覆盖实时 Codex reasoning、历史 reasoning activity 和匿名 ACP thought。

## 完成证据

- `cargo test --workspace`：library 252 项、binary 54 项通过；5 项需手动触发的真实 Runtime
  test 按设计 ignored。`cargo fmt --all -- --check` 与
  `cargo clippy --workspace --all-targets -- -D warnings` 通过。
- `pnpm typecheck`、`pnpm test`、`pnpm build:desktop` 通过；Renderer 为 27 个测试文件、160
  项测试，Qualification Collaboration Audit 另有 4 项 Node 测试。变更脚本全部通过
  `node --check`，`git diff --check` 通过。
- `pnpm smoke:team-context` 在真实 Codex CLI `0.146.0` 上完成 A→B→A：2 个
  ConversationInput、1 个 ReturnObligation、3 个 succeeded Run、3 个 ContextManifest；Core
  restart 后没有重复物化。
- `ROVAI_ANTIGRAVITY_TEAM_PRIVATE_DIR=... pnpm smoke:antigravity-team` 在真实 `agy 1.1.9`
  上完成同一三 Run 链路；普通未绑定 `agy` 的 `tools/list` 为空，13 次直接调用均返回
  `run_not_bound`，SQLite 领域写入为零，restart 后无重复。
- `pnpm smoke:team-tasks` 在真实 Codex CLI `0.146.0` 上完成 Task 创建、读取、认领与完成，
  Task version 为 3，Core restart 后没有重复记录。隔离 Smoke 使用私有 Attested rendezvous，
  不与正在运行的桌面 Core 争用全局 socket。

以上证据完成 v0.32 实施、Runtime Smoke 与正式 Team Qualification。正式 Pass Rate 为
4/12（33.3%）；12/12 协作协议通过证明 `call_member`、忙时 FIFO、显式 Return 和自动 Resume
可用，6/12 功能结果同时表明最终整合能力仍需提升。完整分轴、失败分类和评测集改进见
[Benchmark Review](benchmark-review.md)。
